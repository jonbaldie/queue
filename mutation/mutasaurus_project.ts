import { dirname, join, relative } from "jsr:@std/path";

const SURVIVOR_CHECK_TIMEOUT_MS = 30_000;

interface MutationProject {
  targets: string[];
  tests: string[];
  workers: number;
}

type MutationStatus =
  | "waiting"
  | "killed"
  | "survived"
  | "error"
  | "timed-out"
  | "type-error"
  | "incomplete";

interface RecheckableResults {
  mutations: {
    original: { path: string };
    mutation: string;
    testFilesToRun: string[];
    status: MutationStatus;
  }[];
  killedMutations: number;
  survivedMutations: number;
  timedOutMutations: number;
}

function projectRelativePath(project: string, path: string): string {
  const relativePath = relative(project, path);
  if (
    relativePath === "" || relativePath === ".." ||
    relativePath.startsWith("../") || relativePath.startsWith("..\\")
  ) {
    throw new Error(`Mutation worker path is outside the project: ${path}`);
  }
  return relativePath;
}

async function verifyMutationByExitCode(
  project: string,
  files: Map<string, Uint8Array>,
  generatedTestFiles: Map<string, Uint8Array>,
  mutation: {
    original: { path: string };
    mutation: string;
    testFilesToRun: string[];
  },
): Promise<"killed" | "survived" | "timed-out"> {
  const worker = await Deno.makeTempDir({ prefix: "queue-mutasaurus-verify-" });
  try {
    for (const [path, content] of files) {
      const destination = join(worker, path);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.writeFile(destination, content);
    }
    for (const [path, content] of generatedTestFiles) {
      const destination = join(worker, path);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.writeFile(destination, content);
    }

    const target = join(
      worker,
      projectRelativePath(project, mutation.original.path),
    );
    await Deno.writeTextFile(target, mutation.mutation);

    const tests = mutation.testFilesToRun.map((path) =>
      join(worker, projectRelativePath(project, path))
    );
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SURVIVOR_CHECK_TIMEOUT_MS,
    );
    try {
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["test", "--allow-all", "--no-check", ...tests],
        cwd: worker,
        stdout: "null",
        stderr: "null",
        signal: controller.signal,
      }).output();
      return controller.signal.aborted
        ? "timed-out"
        : result.code === 0
        ? "survived"
        : "killed";
    } catch (error) {
      if (controller.signal.aborted) return "timed-out";
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await Deno.remove(worker, { recursive: true });
  }
}

async function recheckSurvivingMutations(
  project: string,
  files: Map<string, Uint8Array>,
  generatedTestFiles: Map<string, Uint8Array>,
  results: RecheckableResults,
): Promise<{ checked: number; killed: number; timedOut: number }> {
  const survivors = results.mutations.filter((mutation) =>
    mutation.status === "survived"
  );
  let killed = 0;
  let timedOut = 0;
  for (const mutation of survivors) {
    const status = await verifyMutationByExitCode(
      project,
      files,
      generatedTestFiles,
      mutation,
    );
    if (status === "killed") {
      mutation.status = "killed";
      killed++;
    } else if (status === "timed-out") {
      mutation.status = "timed-out";
      timedOut++;
    }
  }

  results.killedMutations += killed;
  results.survivedMutations -= killed + timedOut;
  results.timedOutMutations += timedOut;
  return { checked: survivors.length, killed, timedOut };
}

export async function runMutasaurusProject(
  { targets, tests, workers }: MutationProject,
) {
  const root = Deno.cwd();
  const git = await new Deno.Command("git", {
    args: ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!git.success) {
    throw new Error(
      `Could not list project files: ${new TextDecoder().decode(git.stderr)}`,
    );
  }

  const paths = new TextDecoder().decode(git.stdout).split("\0").filter(
    Boolean,
  );
  const files = new Map<string, Uint8Array>();
  for (const path of paths) {
    try {
      files.set(path, await Deno.readFile(join(root, path)));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  for (const path of [...targets, ...tests]) {
    if (!files.has(path.replace(/^\.\//, ""))) {
      throw new Error(`Mutation project file is missing: ${path}`);
    }
  }

  const targetPaths = new Set(targets.map((path) => path.replace(/^\.\//, "")));
  const project = await Deno.makeTempDir({ prefix: "queue-mutasaurus-" });
  try {
    for (const [path, content] of files) {
      const destination = join(project, path);
      await Deno.mkdir(dirname(destination), { recursive: true });
      await Deno.writeFile(destination, content);
    }

    const entryDir = await Deno.makeTempDir({
      dir: project,
      prefix: "__mutasaurus_tests-",
    });
    const support = [...files].filter(([path]) => !targetPaths.has(path))
      .map(([path, content]) => [path, content.toBase64()]);
    const restorePath = join(entryDir, "restore.ts");
    await Deno.writeTextFile(
      restorePath,
      `
const root = new URL("../", import.meta.url);
const files = ${JSON.stringify(support)};
for (const [path, content] of files) {
  const destination = new URL(path.split("/").map(encodeURIComponent).join("/"), root);
  Deno.mkdirSync(new URL("./", destination), { recursive: true });
  const temporary = new URL(destination.href + "." + crypto.randomUUID());
  Deno.writeFileSync(temporary, Uint8Array.fromBase64(content));
  Deno.renameSync(temporary, destination);
}
Deno.chdir(root);
`,
    );

    const entrypoints: string[] = [];
    for (const [index, test] of tests.entries()) {
      const entrypoint = join(entryDir, `${index}_test.ts`);
      await Deno.writeTextFile(
        entrypoint,
        `import "./restore.ts";\nawait import(new URL(${
          JSON.stringify(`../${test.replace(/^\.\//, "")}`)
        }, import.meta.url).href);\n`,
      );
      entrypoints.push(entrypoint);
    }

    const generatedTestFiles = new Map<string, Uint8Array>();
    for (const path of [...entrypoints, restorePath]) {
      generatedTestFiles.set(
        projectRelativePath(project, path),
        await Deno.readFile(path),
      );
    }

    const { Mutasaurus } = await import("jsr:@mutasaurus/mutasaurus@0.1.4");
    const results = await new Mutasaurus({
      sourceFiles: [...targetPaths].map((path) => join(project, path)),
      // Mutasaurus copies testFiles to workers; restore.ts is imported by the entrypoints.
      testFiles: [...entrypoints, restorePath],
      workingDirectory: project,
      workers,
      noCheck: true,
      silent: true,
    }).run(false);
    if (results.errors.length > 0) {
      throw new Error(
        `Mutasaurus baseline failed:\n${
          results.errors.map((error) =>
            `${error.testFile.path}: ${error.error}`
          ).join("\n")
        }`,
      );
    }
    const verificationStarted = performance.now();
    const verification = await recheckSurvivingMutations(
      project,
      files,
      generatedTestFiles,
      results,
    );
    results.totalTime += performance.now() - verificationStarted;
    if (verification.checked > 0) {
      console.log(
        `Verified ${verification.checked} surviving mutations by test exit code: ${verification.killed} killed, ${verification.timedOut} timed out`,
      );
    }
    return results;
  } finally {
    await Deno.remove(project, { recursive: true });
  }
}
