import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { join } from "jsr:@std/path/join";

// Helper to create real temporary Git repository
async function createTestRepo() {
  const repoDir = await Deno.makeTempDir({ prefix: "queue-skip-test-" });

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
  await Deno.mkdir(join(repoDir, "docs"), { recursive: true });

  await Deno.writeTextFile(
    join(repoDir, "src", "config.ts"),
    "export const config = {};\n",
  );
  await Deno.writeTextFile(join(repoDir, "README.md"), "# Queue\n");
  await Deno.writeTextFile(join(repoDir, "AGENTS.md"), "# Agent guidance\n");
  await Deno.writeTextFile(join(repoDir, ".editorconfig"), "root = true\n");

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

async function createDocsOnlyChange(branchName: string, commitMessage: string) {
  const repo = await createTestRepo();
  await repo.runGit("checkout", "-b", branchName);
  await Deno.writeTextFile(
    join(repo.repoDir, "README.md"),
    "# Updated README\n",
  );
  await repo.runGit("add", ".");
  await repo.runGit("commit", "-m", commitMessage);
  return repo;
}

// Helper to run a mutation runner script
async function runRunnerScript(
  scriptPath: string,
  repoDir: string,
  env: Record<string, string> = {},
  args: string[] = [],
) {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      scriptPath,
      ...args,
    ],
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

Deno.test("skip: mutasaurus clean skip on docs-only PR logs details and does not invoke engine", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "docs/update");
    await Deno.writeTextFile(join(repoDir, "README.md"), "# Updated README\n");
    await Deno.writeTextFile(join(repoDir, "docs", "new_doc.md"), "New doc\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Docs changes only");

    const mutasaurusScript = join(Deno.cwd(), "mutation", "mutasaurus_ci.ts");
    const result = await runRunnerScript(mutasaurusScript, repoDir, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    });

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Comparison base:");
    assertStringIncludes(result.stdout, "clean skip");
    assertStringIncludes(result.stdout, "No mutation engine was invoked");
  } finally {
    await cleanup();
  }
});

Deno.test("skip: mutasaurus defaults to one worker when no worker option is supplied", async () => {
  const { repoDir, cleanup } = await createDocsOnlyChange(
    "docs/default-workers",
    "Document the default worker count",
  );
  try {
    const mutasaurusScript = join(Deno.cwd(), "mutation", "mutasaurus_ci.ts");
    const result = await runRunnerScript(mutasaurusScript, repoDir, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    });

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Mutasaurus workers: 1");
    assertStringIncludes(result.stdout, "No mutation engine was invoked");
  } finally {
    await cleanup();
  }
});

Deno.test("skip: mutasaurus accepts an explicit worker count", async () => {
  const { repoDir, cleanup } = await createDocsOnlyChange(
    "docs/explicit-workers",
    "Document an explicit worker count",
  );
  try {
    const mutasaurusScript = join(Deno.cwd(), "mutation", "mutasaurus_ci.ts");
    const result = await runRunnerScript(
      mutasaurusScript,
      repoDir,
      {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_BASE_REF: "main",
      },
      ["--workers", "4"],
    );

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Mutasaurus workers: 4");
    assertStringIncludes(result.stdout, "No mutation engine was invoked");
  } finally {
    await cleanup();
  }
});

Deno.test("skip: mutasaurus rejects invalid worker values before selection", async () => {
  const invalidArguments = [
    ["--workers", "0"],
    ["--workers", "-1"],
    ["--workers", "1.5"],
    ["--workers", "not-a-number"],
    ["--workers"],
  ];

  for (const args of invalidArguments) {
    const { repoDir, cleanup } = await createDocsOnlyChange(
      "docs/invalid-workers",
      "Try an invalid worker count",
    );
    try {
      const mutasaurusScript = join(Deno.cwd(), "mutation", "mutasaurus_ci.ts");
      const result = await runRunnerScript(
        mutasaurusScript,
        repoDir,
        {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_BASE_REF: "main",
        },
        args,
      );

      assertNotEquals(result.code, 0, `Expected ${args.join(" ")} to fail`);
      assertStringIncludes(
        result.stderr,
        "--workers must be a positive integer",
      );
      assertEquals(result.stdout, "");
    } finally {
      await cleanup();
    }
  }
});

Deno.test("skip: stryker clean skip on docs-only PR logs details and does not invoke engine", async () => {
  const { repoDir, cleanup } = await createDocsOnlyChange(
    "docs/update",
    "Docs changes only",
  );
  try {
    const strykerScript = join(Deno.cwd(), "mutation", "stryker_ci.ts");
    const result = await runRunnerScript(strykerScript, repoDir, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    });

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Stryker concurrency: config default");
    assertStringIncludes(result.stdout, "Comparison base:");
    assertStringIncludes(result.stdout, "clean skip");
    assertStringIncludes(result.stdout, "No mutation engine was invoked");
  } finally {
    await cleanup();
  }
});

Deno.test("skip: stryker accepts an explicit concurrency value", async () => {
  const { repoDir, cleanup } = await createDocsOnlyChange(
    "docs/explicit-concurrency",
    "Document an explicit concurrency value",
  );
  try {
    const strykerScript = join(Deno.cwd(), "mutation", "stryker_ci.ts");
    const result = await runRunnerScript(
      strykerScript,
      repoDir,
      {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_BASE_REF: "main",
      },
      ["--concurrency", "1"],
    );

    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, "Stryker concurrency: 1");
    assertStringIncludes(result.stdout, "No mutation engine was invoked");
  } finally {
    await cleanup();
  }
});

Deno.test("skip: stryker rejects invalid concurrency values before selection", async () => {
  const invalidArguments = [
    ["--concurrency", "0"],
    ["--concurrency", "-1"],
    ["--concurrency", "1.5"],
    ["--concurrency", "not-a-number"],
    ["--concurrency"],
  ];

  for (const args of invalidArguments) {
    const { repoDir, cleanup } = await createDocsOnlyChange(
      "docs/invalid-concurrency",
      "Try an invalid concurrency value",
    );
    try {
      const strykerScript = join(Deno.cwd(), "mutation", "stryker_ci.ts");
      const result = await runRunnerScript(
        strykerScript,
        repoDir,
        {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_BASE_REF: "main",
        },
        args,
      );

      assertNotEquals(result.code, 0, `Expected ${args.join(" ")} to fail`);
      assertStringIncludes(
        result.stderr,
        "--concurrency must be a positive integer",
      );
      assertEquals(result.stdout, "");
    } finally {
      await cleanup();
    }
  }
});

Deno.test("skip: agent-guidance and tooling-only PRs cleanly skip both runners", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "chore/agent-guidance");
    await Deno.writeTextFile(
      join(repoDir, "AGENTS.md"),
      "# Updated agent guidance\n",
    );
    await Deno.writeTextFile(
      join(repoDir, ".editorconfig"),
      "root = true\nindent_size = 2\n",
    );
    await runGit("add", ".");
    await runGit("commit", "-m", "Update agents and editorconfig");

    const mutasaurusScript = join(Deno.cwd(), "mutation", "mutasaurus_ci.ts");
    const strykerScript = join(Deno.cwd(), "mutation", "stryker_ci.ts");

    const mutResult = await runRunnerScript(mutasaurusScript, repoDir, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    });
    assertEquals(mutResult.code, 0);
    assertStringIncludes(mutResult.stdout, "No mutation engine was invoked");

    const strykerResult = await runRunnerScript(strykerScript, repoDir, {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: "main",
    });
    assertEquals(strykerResult.code, 0);
    assertStringIncludes(
      strykerResult.stdout,
      "No mutation engine was invoked",
    );
  } finally {
    await cleanup();
  }
});
