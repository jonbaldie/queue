import { selectMutationTargets } from "./selector.ts";
import { join } from "jsr:@std/path/join";

const selection = await selectMutationTargets();

const modeLabel = selection.mode === "full-suite"
  ? `full-suite (${selection.isFallback ? "fail-closed fallback" : "intentional"})`
  : selection.mode;
console.log(`Comparison base: ${selection.base ?? "none"}${selection.mergeBase ? ` (${selection.mergeBase.slice(0, 8)})` : ""}`);
console.log(`Mode: ${modeLabel}`);
console.log(`Reason: ${selection.reason}`);

if (selection.mode === "skip" || selection.paths.length === 0) {
  console.log(`Skip reason: ${selection.reason}`);
  console.log("No mutation engine was invoked (clean skip).");
  Deno.exit(0);
}

console.log(`Selected targets for Stryker (${selection.paths.length}):`);
for (const f of selection.paths) {
  console.log(`  - ${f}`);
}

const baseConfigPath = join(Deno.cwd(), "mutation", "stryker.config.json");
const baseConfig = JSON.parse(await Deno.readTextFile(baseConfigPath));

let configFileToRun = baseConfigPath;

if (selection.mode === "selected") {
  const tmpConfigPath = join(Deno.cwd(), "mutation", ".stryker.scoped.json");
  const scopedConfig = {
    ...baseConfig,
    mutate: selection.paths,
  };
  await Deno.writeTextFile(tmpConfigPath, JSON.stringify(scopedConfig, null, 2));
  configFileToRun = tmpConfigPath;
}

try {
  const strykerCmd = new Deno.Command("npx", {
    args: ["--no-install", "stryker", "run", configFileToRun],
    stdout: "inherit",
    stderr: "inherit",
  });
  const strykerOutput = await strykerCmd.output();

  if (!strykerOutput.success) {
    console.error("Stryker run failed");
    Deno.exit(strykerOutput.code);
  }

  const checkCmd = new Deno.Command("node", {
    args: ["mutation/stryker_check.js"],
    stdout: "inherit",
    stderr: "inherit",
  });
  const checkOutput = await checkCmd.output();
  Deno.exit(checkOutput.code);
} finally {
  if (configFileToRun !== baseConfigPath) {
    try {
      await Deno.remove(configFileToRun);
    } catch {
      // ignore removal error
    }
  }
}
