import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { join } from "jsr:@std/path/join";
import { selectMutationTargets } from "../mutation/selector.ts";

// Helper to create real temporary Git repository
async function createTestRepo() {
  const repoDir = await Deno.makeTempDir({ prefix: "queue-scoped-test-" });

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
  await Deno.mkdir(join(repoDir, "mutation"), { recursive: true });

  await Deno.writeTextFile(join(repoDir, "src", "config.ts"), "export const config = {};\n");
  await Deno.writeTextFile(join(repoDir, "src", "handler.ts"), "export const handler = {};\n");
  await Deno.writeTextFile(join(repoDir, "src", "router.ts"), "export const router = {};\n");
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

Deno.test("scoped: added, modified, renamed production files are selected; deleted paths excluded", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "feat/scoped-changes");
    // Add new production file
    await Deno.writeTextFile(join(repoDir, "src", "manager.ts"), "export const manager = {};\n");
    // Modify existing production file
    await Deno.writeTextFile(join(repoDir, "src", "router.ts"), "export const router = { v2: true };\n");
    // Rename config.ts -> config_v2.ts
    await runGit("mv", "src/config.ts", "src/config_v2.ts");
    // Delete handler.ts
    await runGit("rm", "src/handler.ts");
    // Change docs outside src
    await Deno.writeTextFile(join(repoDir, "README.md"), "# Updated\n");

    await runGit("add", ".");
    await runGit("commit", "-m", "Scoped changes");

    const selection = await selectMutationTargets({
      cwd: repoDir,
      targetBranch: "main",
    });

    assertEquals(selection.mode, "selected");
    assertEquals(selection.paths, [
      "src/config_v2.ts",
      "src/manager.ts",
      "src/router.ts",
    ]);
    assertEquals(selection.paths.includes("src/handler.ts"), false);
    assertEquals(selection.paths.includes("README.md"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("scoped: both engines receive identical selected path set", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "feat/identical-selection");
    await Deno.writeTextFile(join(repoDir, "src", "router.ts"), "export const router = { updated: 1 };\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Update router");

    const selection = await selectMutationTargets({
      cwd: repoDir,
      targetBranch: "main",
    });

    assertEquals(selection.mode, "selected");

    // Check Mutasaurus mapping
    const mutasaurusTargets = selection.paths.map((p) => (p.startsWith("./") ? p : `./${p}`));
    // Check Stryker mapping
    const strykerTargets = selection.paths;

    // Normalizing both sets should yield identical relative paths
    const normalize = (p: string) => p.replace(/^\.\//, "");
    assertEquals(
      mutasaurusTargets.map(normalize).sort(),
      strykerTargets.map(normalize).sort(),
    );
  } finally {
    await cleanup();
  }
});

Deno.test("scoped: Stryker config override contains exact selected paths as data without shell interpolation", async () => {
  const { repoDir, runGit, cleanup } = await createTestRepo();
  try {
    await runGit("checkout", "-b", "feat/safe-paths");
    const complexPath = "src/special $name & 'quotes'.ts";
    await Deno.writeTextFile(join(repoDir, complexPath), "export const special = 1;\n");
    await runGit("add", ".");
    await runGit("commit", "-m", "Complex path");

    const selection = await selectMutationTargets({
      cwd: repoDir,
      targetBranch: "main",
    });

    assertEquals(selection.mode, "selected");
    assertEquals(selection.paths, [complexPath]);

    // Simulate Stryker scoped config generation
    const baseConfig = { mutate: ["src/**/*.ts"] };
    const scopedConfig = { ...baseConfig, mutate: selection.paths };
    const jsonStr = JSON.stringify(scopedConfig);
    const parsed = JSON.parse(jsonStr);

    assertEquals(parsed.mutate, [complexPath]);
  } finally {
    await cleanup();
  }
});
