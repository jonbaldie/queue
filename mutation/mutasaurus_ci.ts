import { Mutasaurus } from "jsr:@mutasaurus/mutasaurus@0.1.4";

const THRESHOLD = 80;

const mutasaurus = new Mutasaurus({
  sourceFiles: [
    "./src/config.ts",
    "./src/handler.ts",
    "./src/manager.ts",
    "./src/middleware.ts",
    "./src/persist.ts",
    "./src/rate_limiter.ts",
    "./src/router.ts",
  ],
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
