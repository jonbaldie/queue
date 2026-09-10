import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { join } from "jsr:@std/path/join";

// Helper to create real temporary Git repository
async function createTestRepo(directory?: string) {
  const repoDir = directory === undefined
    ? await Deno.makeTempDir({ prefix: "queue-skip-test-" })
    : await Deno.makeTempDir({ dir: directory, prefix: "queue-skip-test-" });

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

async function createMutationEngineRepo() {
  const repo = await createTestRepo();
  await Deno.writeTextFile(
    join(repo.repoDir, "src", "config.ts"),
    "export function config(value: number): number { return value + 1; }\n",
  );

  const testFiles = [
    "config",
    "e2e",
    "handler",
    "manager",
    "persist",
    "rate_limiter",
    "router",
  ];
  for (const name of testFiles) {
    const content = name === "config"
      ? [
        'import { assertEquals } from "jsr:@std/assert";',
        'import { config } from "../src/config.ts";',
        'Deno.test("config", () => assertEquals(config(1), 2));',
        "",
      ].join("\n")
      : 'Deno.test("placeholder", () => {});\n';
    await Deno.writeTextFile(
      join(repo.repoDir, "tests", `${name}_test.ts`),
      content,
    );
  }
  await repo.runGit("add", ".");
  await repo.runGit("commit", "-m", "Add executable mutation fixture");
  return repo;
}

async function createStrykerEngineRepo() {
  const repo = await createTestRepo(Deno.cwd());
  await Deno.writeTextFile(
    join(repo.repoDir, "src", "config.ts"),
    "export function config(value: number): number { return value + 1; }\n",
  );
  await Deno.writeTextFile(
    join(repo.repoDir, "tests", "config_test.ts"),
    [
      'import { assertEquals } from "jsr:@std/assert";',
      'import { config } from "../src/config.ts";',
      'Deno.test("config", () => assertEquals(config(1), 2));',
      "",
    ].join("\n"),
  );
  await Deno.writeTextFile(
    join(repo.repoDir, "mutation", "stryker.config.json"),
    JSON.stringify(
      {
        mutate: ["src/config.ts"],
        testRunner: "command",
        commandRunner: {
          command: "deno test --allow-read --allow-env --no-check",
        },
        reporters: ["json", "clear-text"],
        jsonReporter: { fileName: "mutation/stryker-report.json" },
        coverageAnalysis: "off",
        timeoutMS: 30000,
        thresholds: { high: 0, low: 0, break: null },
        concurrency: 2,
      },
      null,
      2,
    ),
  );
  await Deno.writeTextFile(
    join(repo.repoDir, "mutation", "stryker_check.js"),
    [
      'const report = JSON.parse(require("node:fs").readFileSync("mutation/stryker-report.json", "utf8"));',
      "const mutants = Object.values(report.files).flatMap((file) => file.mutants);",
      'if (mutants.length === 0 || mutants.some((mutant) => mutant.status !== "Killed")) process.exit(1);',
      'console.log("fixture check passed");',
      "",
    ].join("\n"),
  );
  await repo.runGit("add", ".");
  await repo.runGit("commit", "-m", "Add executable Stryker fixture");
  return repo;
}

// Helper to run a mutation runner script
async function runRunnerScript(
  scriptPath: string,
  repoDir: string,
  env: Record<string, string> = {},
  args: string[] = [],
  runtimeArgs: string[] = [],
) {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      ...runtimeArgs,
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

Deno.test("runner: mutasaurus invokes the real engine with an explicit worker count", async () => {
  const { repoDir, cleanup } = await createMutationEngineRepo();
  try {
    const mutasaurusScript = join(Deno.cwd(), "mutation", "mutasaurus_ci.ts");
    const result = await runRunnerScript(
      mutasaurusScript,
      repoDir,
      { GITHUB_EVENT_NAME: "push" },
      ["--workers", "1"],
      ["--node-modules-dir=auto", "--allow-ffi", "--allow-sys"],
    );

    assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assertStringIncludes(result.stdout, "Mutasaurus workers: 1");
    assertStringIncludes(result.stdout, "Overall: 100% (1/1)");
  } finally {
    await cleanup();
  }
});

Deno.test("runner: stryker invokes the real engine with explicit concurrency", async () => {
  const { repoDir, cleanup } = await createStrykerEngineRepo();
  try {
    const strykerScript = join(Deno.cwd(), "mutation", "stryker_ci.ts");
    const result = await runRunnerScript(
      strykerScript,
      repoDir,
      { GITHUB_EVENT_NAME: "push" },
      ["--concurrency", "1"],
    );

    const output = `${result.stdout}\n${result.stderr}`;
    assertEquals(result.code, 0, output);
    assertStringIncludes(output, "Stryker concurrency: 1");
    assertStringIncludes(output, "Creating 1 test runner process(es)");
    assertStringIncludes(output, "fixture check passed");
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
    ["--workers", "9007199254740992"],
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
    ["--concurrency", "9007199254740992"],
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
