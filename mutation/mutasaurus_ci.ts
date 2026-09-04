import { selectMutationTargets } from "./selector.ts";

const THRESHOLD = 80;

const selection = await selectMutationTargets();

console.log(`Comparison base: ${selection.base ?? "none"}${selection.mergeBase ? ` (${selection.mergeBase.slice(0, 8)})` : ""}`);
console.log(`Mode: ${selection.mode}${selection.isFallback ? " (fail-closed fallback)" : ""}`);
console.log(`Reason: ${selection.reason}`);

if (selection.mode === "skip" || selection.paths.length === 0) {
  console.log(`Skip reason: ${selection.reason}`);
  console.log("No mutation engine was invoked (clean skip).");
  Deno.exit(0);
}

const { Mutasaurus } = await import("jsr:@mutasaurus/mutasaurus@0.1.4");

const sourceFiles = selection.paths.map((p) => (p.startsWith("./") ? p : `./${p}`));
console.log(`Selected targets for Mutasaurus (${sourceFiles.length}):`);
for (const f of sourceFiles) {
  console.log(`  - ${f}`);
}

const mutasaurus = new Mutasaurus({
  sourceFiles,
  testFiles: [
    "./tests/config_test.ts",
    "./tests/e2e_test.ts",
    "./tests/handler_test.ts",
    "./tests/manager_test.ts",
    "./tests/persist_test.ts",
    "./tests/rate_limiter_test.ts",
  ],
  workers: 4,
  noCheck: true,
  silent: true,
});

const results = await mutasaurus.run(false);

const fileStats: Map<string, { total: number; killed: number }> = new Map();
for (const m of results.mutations) {
  const path = (m.original as { path: string }).path.replace(
    /^.*\/src\//,
    "src/",
  );
  const stat = fileStats.get(path) ?? { total: 0, killed: 0 };
  stat.total++;
  if (
    m.status === "killed" || m.status === "timed-out" ||
    m.status === "type-error"
  ) {
    stat.killed++;
  }
  fileStats.set(path, stat);
}

const overall = Math.round(
  results.killedMutations / results.totalMutations * 100,
);
console.log(`\nMutasaurus results (threshold: ${THRESHOLD}%)`);
console.log(
  `Overall: ${overall}% (${results.killedMutations}/${results.totalMutations}) in ${
    (results.totalTime / 1000).toFixed(1)
  }s\n`,
);

let failed = false;
for (const [file, stat] of fileStats) {
  const score = stat.total === 0
    ? 100
    : Math.round(stat.killed / stat.total * 100);
  const pass = score >= THRESHOLD;
  if (!pass) failed = true;
  console.log(
    `  ${
      pass ? "PASS" : "FAIL"
    } ${file}: ${score}% (${stat.killed}/${stat.total})`,
  );
}

if (failed) {
  console.error(`\nFAIL: one or more files scored below ${THRESHOLD}%`);
  Deno.exit(1);
}

console.log(`\nPASS: all files ≥${THRESHOLD}%`);
