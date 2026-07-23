import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const messcriptRepository = "https://github.com/quality-gates/messcript.git";
const messcriptCommit = "4fe47bd0f15675206aedd0f22ae5eff7aeb01707";
const toolRoot = join(projectRoot, "node_modules", ".cache", "queue-messcript");
const buildMarker = join(toolRoot, `.built-${messcriptCommit}`);
const messcriptCli = join(toolRoot, "dist", "cli.js");

const productionUnits = new Map([
  ["configuration", ["src/config.ts"]],
  ["router", ["src/router.ts"]],
  ["middleware", ["src/middleware.ts"]],
  ["rate-limiter", ["src/rate_limiter.ts"]],
  ["queue-manager", ["src/manager.ts"]],
  ["persist-engine", ["src/persist.ts"]],
  ["http-handler", ["src/handler.ts"]],
  ["entrypoint", ["main.ts"]],
]);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Unable to run ${command}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    return undefined;
  }

  return result.stdout.trim();
}

function acquireMesscript() {
  mkdirSync(dirname(toolRoot), { recursive: true });

  if (!existsSync(join(toolRoot, ".git"))) {
    if (existsSync(toolRoot)) {
      throw new Error(`${toolRoot} exists but is not a Git checkout`);
    }

    const cloneExit = run("git", [
      "clone",
      "--quiet",
      messcriptRepository,
      toolRoot,
    ], projectRoot);
    if (cloneExit !== 0) {
      return cloneExit;
    }
  }

  const fetchExit = run(
    "git",
    ["fetch", "--quiet", "origin", messcriptCommit],
    toolRoot,
  );
  if (fetchExit !== 0) {
    return fetchExit;
  }

  const checkoutExit = run("git", [
    "checkout",
    "--quiet",
    "--detach",
    messcriptCommit,
  ], toolRoot);
  if (checkoutExit !== 0) {
    return checkoutExit;
  }

  const checkedOutCommit = capture("git", ["rev-parse", "HEAD"], toolRoot);
  if (checkedOutCommit !== messcriptCommit) {
    throw new Error(
      `messcript checkout is ${
        checkedOutCommit ?? "unknown"
      }, expected ${messcriptCommit}`,
    );
  }

  if (!existsSync(buildMarker) || !existsSync(messcriptCli)) {
    const installExit = run("npm", [
      "ci",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ], toolRoot);
    if (installExit !== 0) {
      return installExit;
    }

    const buildExit = run("npm", ["run", "build"], toolRoot);
    if (buildExit !== 0) {
      return buildExit;
    }

    writeFileSync(buildMarker, `${messcriptCommit}\n`);
  }

  return 0;
}

function requestedPaths(unitName) {
  if (unitName === "all") {
    return [...productionUnits.values()].flat();
  }

  const paths = productionUnits.get(unitName);
  if (!paths) {
    const names = [...productionUnits.keys(), "all"].join(", ");
    throw new Error(
      `Unknown production unit '${unitName}'. Choose one of: ${names}`,
    );
  }
  return paths;
}

const unitName = process.argv[2] ?? "all";

try {
  const paths = requestedPaths(unitName);
  const acquireExit = acquireMesscript();
  if (acquireExit !== 0) {
    process.exitCode = acquireExit;
  } else {
    process.exitCode = run(
      "node",
      [messcriptCli, paths.join(","), "text", "typescript", "--color=never"],
      projectRoot,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
