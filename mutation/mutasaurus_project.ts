import { dirname, join } from "jsr:@std/path";

interface MutationProject {
  targets: string[];
  tests: string[];
  workers: number;
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
    return results;
  } finally {
    await Deno.remove(project, { recursive: true });
  }
}
