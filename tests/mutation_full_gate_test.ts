import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { join } from "jsr:@std/path/join";

// Helper to create real temporary Git repository
async function createTestRepo() {
  const repoDir = await Deno.makeTempDir({ prefix: "queue-full-gate-test-" });

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

  await Deno.mkdir(join(repoDir, "src"), { recursive: true });
  await Deno.mkdir(join(repoDir, "tests"), { recursive: true });
  await Deno.mkdir(join(repoDir, "mutation"), { recursive: true });
  await Deno.mkdir(join(repoDir, ".github", "workflows"), { recursive: true });

  await Deno.writeTextFile(join(repoDir, "src", "config.ts"), "export const config = {};\n");
  await Deno.writeTextFile(join(repoDir, "src", "handler.ts"), "export const handler = {};\n");
  await Deno.writeTextFile(join(repoDir, "tests", "handler_test.ts"), "export const t = 1;\n");
  await Deno.writeTextFile(join(repoDir, "mutation", "mutasaurus_ci.ts"), "console.log('runner');\n");
  await Deno.writeTextFile(join(repoDir, ".github", "workflows", "ci.yml"), "name: CI\n");
  await Deno.writeTextFile(join(repoDir, "README.md"), "# Queue\n");

  await runGit("add", ".");
  await runGit("commit", "-m", "Initial commit");

  const cleanup = async () => {
    try {
      await Deno.remove(repoDir, { recursive: true });
    } catch {
      // ignore
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

Deno.test("full-gate: test change triggers intentional full-suite mode in both engines", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "test/update-handler-test");
    await Deno.writeTextFile(join(repoDir, "tests", "handler_test.ts"), "export const t = 2;\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Update handler test");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main"]);
    assertEquals(result.code, 0);

    assertStringIncludes(result.stdout, "Mode: full-suite (intentional)");
    assertStringIncludes(result.stdout, "Reason: Full suite triggered by change to test");
    assertStringIncludes(result.stdout, "src/config.ts");
    assertStringIncludes(result.stdout, "src/handler.ts");
  } finally {
    await cleanup();
  }
});

Deno.test("full-gate: mutation-infrastructure change triggers intentional full-suite mode", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "chore/update-mutation-ci");
    await Deno.writeTextFile(join(repoDir, "mutation", "mutasaurus_ci.ts"), "console.log('updated');\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Update mutation script");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main"]);
    assertEquals(result.code, 0);

    assertStringIncludes(result.stdout, "Mode: full-suite (intentional)");
    assertStringIncludes(result.stdout, "mutation");
  } finally {
    await cleanup();
  }
});

Deno.test("full-gate: CI workflow change triggers intentional full-suite mode", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "ci/update-workflow");
    await Deno.writeTextFile(join(repoDir, ".github", "workflows", "ci.yml"), "name: CI 2\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Update CI workflow");

    const result = await runSelectorCli(repoDir, ["--target-branch", "main"]);
    assertEquals(result.code, 0);

    assertStringIncludes(result.stdout, "Mode: full-suite (intentional)");
    assertStringIncludes(result.stdout, "workflow");
  } finally {
    await cleanup();
  }
});

Deno.test("full-gate: main or release push triggers intentional full-suite mode", async () => {
  const { repoDir, cleanup } = await createTestRepo();
  try {
    const result = await runSelectorCli(repoDir, [], {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
    });
    assertEquals(result.code, 0);

    assertStringIncludes(result.stdout, "Mode: full-suite (intentional)");
    assertStringIncludes(result.stdout, "Non-PR build (event: push)");
  } finally {
    await cleanup();
  }
});

Deno.test("full-gate: missing or ambiguous target branch triggers fail-closed fallback mode", async () => {
  const { repoDir, cleanup } = await createTestRepo();
  try {
    const result = await runSelectorCli(repoDir, ["--target-branch", "missing-target-ref"]);
    assertEquals(result.code, 0);

    assertStringIncludes(result.stdout, "Mode: full-suite (fail-closed fallback)");
    assertStringIncludes(result.stdout, "failing closed to full suite");
    assertStringIncludes(result.stdout, "src/config.ts");
    assertStringIncludes(result.stdout, "src/handler.ts");
  } finally {
    await cleanup();
  }
});
