import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { join } from "jsr:@std/path/join";

// Helper to create real temporary Git repositories for testing
async function createTestRepo() {
  const repoDir = await Deno.makeTempDir({ prefix: "queue-selector-test-" });

  const runGit = async (...args: string[]) => {
    const cmd = new Deno.Command("git", {
      args,
      cwd: repoDir,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    if (!output.success) {
      const err = new TextDecoder().decode(output.stderr);
      throw new Error(`git ${args.join(" ")} failed: ${err}`);
    }
    return new TextDecoder().decode(output.stdout).trim();
  };

  await runGit("init", "-b", "main");
  await runGit("config", "user.name", "Test Committer");
  await runGit("config", "user.email", "committer@example.com");

  // Create base structure
  await Deno.mkdir(join(repoDir, "src"), { recursive: true });
  await Deno.mkdir(join(repoDir, "tests"), { recursive: true });
  await Deno.mkdir(join(repoDir, "mutation"), { recursive: true });
  await Deno.mkdir(join(repoDir, ".github", "workflows"), { recursive: true });
  await Deno.mkdir(join(repoDir, "docs"), { recursive: true });

  await Deno.writeTextFile(join(repoDir, "src", "config.ts"), "export const config = {};\n");
  await Deno.writeTextFile(join(repoDir, "src", "handler.ts"), "export const handler = {};\n");
  await Deno.writeTextFile(join(repoDir, "tests", "handler_test.ts"), "export const t = 1;\n");
  await Deno.writeTextFile(join(repoDir, "mutation", "stryker.config.json"), "{}\n");
  await Deno.writeTextFile(join(repoDir, ".github", "workflows", "ci.yml"), "name: CI\n");
  await Deno.writeTextFile(join(repoDir, "README.md"), "# Queue\n");

  await runGit("add", ".");
  await runGit("commit", "-m", "Initial commit");

  const cleanup = async () => {
    try {
      await Deno.remove(repoDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  };

  return { repoDir, runGit, cleanup };
}

// Helper to run selector CLI against a repository
async function runSelectorCli(repoDir: string, args: string[], env: Record<string, string> = {}) {
  const selectorPath = join(Deno.cwd(), "mutation", "selector.ts");
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-run", "--allow-read", "--allow-env", selectorPath, ...args],
    cwd: repoDir,
    env: {
      ...Deno.env.toObject(),
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  return {
    code: output.code,
    stdout,
    stderr,
  };
}

Deno.test("selector: added or modified production TypeScript files return selected mode with head paths", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "feat/new-handler");
    await Deno.writeTextFile(join(repoDir, "src", "router.ts"), "export const router = {};\n");
    await Deno.writeTextFile(join(repoDir, "src", "handler.ts"), "export const handler = { updated: true };\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Add router and modify handler");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "selected");
    assertEquals(parsed.paths.sort(), ["src/handler.ts", "src/router.ts"]);
    assertStringIncludes(result.stdout, "selected");
  } finally {
    await cleanup();
  }
});

Deno.test("selector: renamed and copied production files returned under head paths, deleted files excluded", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "feat/rename-and-delete");
    // Rename handler.ts -> handler_v2.ts
    await runGit("mv", "src/handler.ts", "src/handler_v2.ts");
    // Delete config.ts
    await runGit("rm", "src/config.ts");
    await runGit("commit", "-m", "Rename handler and delete config");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "selected");
    assertEquals(parsed.paths, ["src/handler_v2.ts"]);
  } finally {
    await cleanup();
  }
});

Deno.test("selector: diff with only docs or agent guidance returns clean skip", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "docs/update");
    await Deno.writeTextFile(join(repoDir, "README.md"), "# Updated README\n");
    await Deno.writeTextFile(join(repoDir, "docs", "guide.md"), "Guide content\n");
    await Deno.writeTextFile(join(repoDir, "AGENTS.md"), "Operational guide\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Update documentation");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "skip");
    assertEquals(parsed.paths, []);
    assertStringIncludes(parsed.reason.toLowerCase(), "skip");
  } finally {
    await cleanup();
  }
});

Deno.test("selector: test-suite changes trigger full-suite mode", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "test/add-test");
    await Deno.writeTextFile(join(repoDir, "tests", "new_test.ts"), "Deno.test('x', () => {});\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Add new test");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "full-suite");
    assertStringIncludes(parsed.reason.toLowerCase(), "test");
    assertEquals(parsed.paths.includes("src/config.ts"), true);
    assertEquals(parsed.paths.includes("src/handler.ts"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("selector: mutation config or runner changes trigger full-suite mode", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "chore/mutation-runner");
    await Deno.writeTextFile(join(repoDir, "mutation", "mutasaurus_ci.ts"), "console.log('runner');\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Update mutation runner");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "full-suite");
    assertStringIncludes(parsed.reason.toLowerCase(), "mutation");
  } finally {
    await cleanup();
  }
});

Deno.test("selector: CI workflow orchestration changes trigger full-suite mode", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "ci/workflow-change");
    await Deno.writeTextFile(join(repoDir, ".github", "workflows", "ci.yml"), "name: CI (updated)\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Update CI workflow");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "full-suite");
    assertStringIncludes(parsed.reason.toLowerCase(), "workflow");
  } finally {
    await cleanup();
  }
});

Deno.test("selector: non-PR build defaults to full-suite mode", async () => {
  const { repoDir, cleanup } = await createTestRepo();
  try {
    // When run without target branch and GITHUB_EVENT_NAME is push
    const result = await runSelectorCli(repoDir, ["--json"], {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_BASE_REF: "",
    });
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "full-suite");
    assertStringIncludes(parsed.reason.toLowerCase(), "non-pr");
  } finally {
    await cleanup();
  }
});

Deno.test("selector: actual PR target branch is used when targeting non-main branch", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "release/1.0");
    await Deno.writeTextFile(join(repoDir, "src", "release_feature.ts"), "export const rel = 1;\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Release 1.0 commit");

    // Branch off release/1.0
    await runGit("checkout", "-b", "feat/release-patch");
    await Deno.writeTextFile(join(repoDir, "src", "patch.ts"), "export const patch = 1;\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Patch on release branch");

    const result = await runSelectorCli(repoDir, ["--target-branch", "release/1.0", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "selected");
    assertEquals(parsed.paths, ["src/patch.ts"]);
  } finally {
    await cleanup();
  }
});

Deno.test("selector: unavailable target branch fails closed to full-suite mode with error log", async () => {
  const { repoDir, cleanup } = await createTestRepo();
  try {
    const result = await runSelectorCli(repoDir, ["--target-branch", "non-existent-branch", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "full-suite");
    assertEquals(parsed.isFallback, true);
    assertStringIncludes(parsed.reason.toLowerCase(), "non-existent-branch");
  } finally {
    await cleanup();
  }
});

Deno.test("selector: paths containing spaces and special characters are handled safely as data", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "feat/special-paths");
    const specialFile = "src/foo bar $baz & 'quote'.ts";
    await Deno.writeTextFile(join(repoDir, specialFile), "export const special = true;\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Add special file");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main", "--json"]);
    assertEquals(result.code, 0);

    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed.mode, "selected");
    assertEquals(parsed.paths, [specialFile]);
  } finally {
    await cleanup();
  }
});

Deno.test("selector: human-readable log identifies comparison base, selected mode, reason, and selected paths", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "feat/readable-log");
    await Deno.writeTextFile(join(repoDir, "src", "handler.ts"), "export const updated = 2;\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Modify handler");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main"]);
    assertEquals(result.code, 0);

    assertStringIncludes(result.stdout, "Comparison base:");
    assertStringIncludes(result.stdout, "Mode: selected");
    assertStringIncludes(result.stdout, "Reason:");
    assertStringIncludes(result.stdout, "src/handler.ts");
  } finally {
    await cleanup();
  }
});
