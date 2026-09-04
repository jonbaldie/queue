import { parseArgs } from "jsr:@std/cli/parse-args";
import { join } from "jsr:@std/path/join";

export type SelectorMode = "selected" | "full-suite" | "skip";

export interface SelectorResult {
  mode: SelectorMode;
  reason: string;
  base?: string;
  head?: string;
  mergeBase?: string;
  paths: string[];
  isFallback?: boolean;
}

export interface SelectorOptions {
  cwd?: string;
  targetBranch?: string;
  headRef?: string;
  prEvent?: boolean;
}

interface GitCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

async function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    return {
      success: output.success,
      stdout: new TextDecoder().decode(output.stdout).trim(),
      stderr: new TextDecoder().decode(output.stderr).trim(),
    };
  } catch (err) {
    return {
      success: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runGitRaw(args: string[], cwd: string): Promise<{ success: boolean; stdout: Uint8Array; stderr: string }> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    return {
      success: output.success,
      stdout: output.stdout,
      stderr: new TextDecoder().decode(output.stderr).trim(),
    };
  } catch (err) {
    return {
      success: false,
      stdout: new Uint8Array(),
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getAllProductionFiles(cwd: string): Promise<string[]> {
  const srcDir = join(cwd, "src");
  const files: string[] = [];

  async function walk(dir: string, prefix: string) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          await walk(join(dir, entry.name), rel);
        } else if (entry.isFile && entry.name.endsWith(".ts")) {
          files.push(`src/${rel}`);
        }
      }
    } catch {
      // src dir might not exist in a minimal repo
    }
  }

  await walk(srcDir, "");
  return files.sort();
}

async function resolveTargetRef(targetBranch: string, cwd: string): Promise<string | null> {
  const candidates = [
    targetBranch,
    `origin/${targetBranch}`,
    `refs/remotes/origin/${targetBranch}`,
    `refs/heads/${targetBranch}`,
  ];

  for (const candidate of candidates) {
    const check = await runGit(["rev-parse", "--verify", "--quiet", candidate], cwd);
    if (check.success) {
      return candidate;
    }
  }

  // Attempt fetch from origin if available
  const fetchResult = await runGit(["fetch", "origin", targetBranch], cwd);
  if (fetchResult.success) {
    for (const candidate of candidates) {
      const check = await runGit(["rev-parse", "--verify", "--quiet", candidate], cwd);
      if (check.success) {
        return candidate;
      }
    }
  }

  return null;
}

export async function selectMutationTargets(options: SelectorOptions = {}): Promise<SelectorResult> {
  const cwd = options.cwd ?? Deno.cwd();
  const headRef = options.headRef ?? "HEAD";

  // Check event type and environment
  const eventName = Deno.env.get("GITHUB_EVENT_NAME");
  const envBaseRef = Deno.env.get("GITHUB_BASE_REF");
  const isPrExplicit = options.prEvent ?? (eventName ? eventName === "pull_request" : undefined);
  const targetBranch = options.targetBranch ?? (envBaseRef && envBaseRef.trim().length > 0 ? envBaseRef.trim() : undefined);

  // If GITHUB_EVENT_NAME is set to a non-PR event (e.g. push to main, workflow_dispatch)
  if (eventName && eventName !== "pull_request" && !options.targetBranch) {
    const allProd = await getAllProductionFiles(cwd);
    return {
      mode: "full-suite",
      reason: `Non-PR build (event: ${eventName}) runs full mutation suite`,
      paths: allProd,
      isFallback: false,
    };
  }

  // If no target branch is specified and not explicitly marked as PR
  if (!targetBranch) {
    const allProd = await getAllProductionFiles(cwd);
    if (isPrExplicit === true) {
      return {
        mode: "full-suite",
        reason: "Pull request target branch not specified; failing closed to full suite",
        paths: allProd,
        isFallback: true,
      };
    }
    return {
      mode: "full-suite",
      reason: "Non-PR build (no target branch) runs full mutation suite",
      paths: allProd,
      isFallback: false,
    };
  }

  // Resolve target branch ref
  const resolvedTarget = await resolveTargetRef(targetBranch, cwd);
  if (!resolvedTarget) {
    const allProd = await getAllProductionFiles(cwd);
    return {
      mode: "full-suite",
      reason: `Target branch '${targetBranch}' could not be resolved or fetched; failing closed to full suite`,
      base: targetBranch,
      head: headRef,
      paths: allProd,
      isFallback: true,
    };
  }

  // Calculate merge-base
  const mbResult = await runGit(["merge-base", resolvedTarget, headRef], cwd);
  if (!mbResult.success || !mbResult.stdout) {
    const allProd = await getAllProductionFiles(cwd);
    return {
      mode: "full-suite",
      reason: `Merge-base calculation failed between '${resolvedTarget}' and '${headRef}'; failing closed to full suite`,
      base: resolvedTarget,
      head: headRef,
      paths: allProd,
      isFallback: true,
    };
  }
  const mergeBaseSha = mbResult.stdout.trim();

  // Diff name-status with NUL delimiter
  const diffResult = await runGitRaw(["diff", "--name-status", "-z", mergeBaseSha, headRef], cwd);
  if (!diffResult.success) {
    const allProd = await getAllProductionFiles(cwd);
    return {
      mode: "full-suite",
      reason: `git diff failed against merge-base ${mergeBaseSha}; failing closed to full suite`,
      base: resolvedTarget,
      head: headRef,
      mergeBase: mergeBaseSha,
      paths: allProd,
      isFallback: true,
    };
  }

  // Parse NUL-delimited diff tokens
  const rawBytes = diffResult.stdout;
  const decoded = new TextDecoder().decode(rawBytes);
  const tokens = decoded.split("\0");
  if (tokens.length > 0 && tokens[tokens.length - 1] === "") {
    tokens.pop();
  }

  interface FileChange {
    status: string;
    path: string;
    oldPath?: string;
  }

  const changes: FileChange[] = [];
  let idx = 0;
  while (idx < tokens.length) {
    const statusToken = tokens[idx++];
    if (!statusToken) break;
    const statusCode = statusToken[0];
    if (statusCode === "R" || statusCode === "C") {
      const oldPath = tokens[idx++];
      const newPath = tokens[idx++];
      changes.push({ status: statusCode, path: newPath, oldPath });
    } else {
      const filePath = tokens[idx++];
      changes.push({ status: statusCode, path: filePath });
    }
  }

  // Check if any changes trigger full-suite mode
  for (const change of changes) {
    const p = change.path;
    const oldP = change.oldPath;
    const isTrigger = (f: string) =>
      f.startsWith("tests/") ||
      f.startsWith("mutation/") ||
      f.startsWith(".github/");

    if (isTrigger(p) || (oldP && isTrigger(oldP))) {
      const allProd = await getAllProductionFiles(cwd);
      return {
        mode: "full-suite",
        reason: `Full suite triggered by change to test, mutation, or workflow infrastructure: ${p}`,
        base: resolvedTarget,
        head: headRef,
        mergeBase: mergeBaseSha,
        paths: allProd,
        isFallback: false,
      };
    }
  }

  // Collect changed production TypeScript files
  const selectedPathsSet = new Set<string>();
  for (const change of changes) {
    if (change.status === "D") {
      // Exclude deleted files
      continue;
    }
    if (change.path.startsWith("src/") && change.path.endsWith(".ts")) {
      selectedPathsSet.add(change.path);
    }
  }

  const selectedPaths = [...selectedPathsSet].sort();

  if (selectedPaths.length > 0) {
    return {
      mode: "selected",
      reason: `PR changed production source files (${selectedPaths.join(", ")})`,
      base: resolvedTarget,
      head: headRef,
      mergeBase: mergeBaseSha,
      paths: selectedPaths,
      isFallback: false,
    };
  }

  return {
    mode: "skip",
    reason: "No production TypeScript or mutation infrastructure changed; clean skip",
    base: resolvedTarget,
    head: headRef,
    mergeBase: mergeBaseSha,
    paths: [],
    isFallback: false,
  };
}

// CLI execution
if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["target-branch", "base", "head", "output", "cwd"],
    boolean: ["json", "help"],
    alias: { b: "target-branch", o: "output", h: "help" },
  });

  if (args.help) {
    console.log(`Mutation Target Selector
Usage:
  deno run --allow-run --allow-read --allow-env mutation/selector.ts [options]

Options:
  --target-branch, -b <branch>  Target branch to compare against (e.g. main)
  --head <ref>                  Head commit/ref (default: HEAD)
  --output, -o <file>           Write JSON result to specified file
  --json                        Print JSON output to stdout
  --cwd <dir>                   Working directory
  --help, -h                    Show this help
`);
    Deno.exit(0);
  }

  const targetBranch = args["target-branch"] ?? args.base;
  const result = await selectMutationTargets({
    cwd: args.cwd,
    targetBranch,
    headRef: args.head,
  });

  if (args.output) {
    await Deno.writeTextFile(args.output, JSON.stringify(result, null, 2) + "\n");
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const modeLabel = result.mode === "full-suite"
      ? `full-suite (${result.isFallback ? "fail-closed fallback" : "intentional"})`
      : result.mode;
    console.log(`Comparison base: ${result.base ?? "none"}${result.mergeBase ? ` (${result.mergeBase.slice(0, 8)})` : ""}`);
    console.log(`Mode: ${modeLabel}`);
    console.log(`Reason: ${result.reason}`);
    if (result.paths.length > 0) {
      console.log(`Selected targets (${result.paths.length}):`);
      for (const p of result.paths) {
        console.log(`  - ${p}`);
      }
    } else {
      console.log(`Selected targets: (none)`);
    }
  }
}
