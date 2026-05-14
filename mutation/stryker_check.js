#!/usr/bin/env node
// Reads stryker-report.json and fails if any file scores below THRESHOLD.
import { readFileSync } from "node:fs";

const THRESHOLD = 80;
const report = JSON.parse(readFileSync("mutation/stryker-report.json", "utf8"));

let failed = false;
console.log(`\nStryker per-file scores (threshold: ${THRESHOLD}%):`);

for (const [filePath, fileResult] of Object.entries(report.files)) {
  const shortPath = filePath.replace(/^.*\/src\//, "src/");
  const mutants = fileResult.mutants;
  const total = mutants.length;
  if (total === 0) continue;

  const killed = mutants.filter(
    (m) => m.status === "Killed" || m.status === "Timeout" || m.status === "CompileError"
  ).length;

  const score = Math.round((killed / total) * 100);
  const pass = score >= THRESHOLD;
  if (!pass) failed = true;
  console.log(`  ${pass ? "PASS" : "FAIL"} ${shortPath}: ${score}% (${killed}/${total})`);
}

if (failed) {
  console.error(`\nFAIL: one or more files scored below ${THRESHOLD}%`);
  process.exit(1);
}

console.log(`\nPASS: all files ≥${THRESHOLD}%`);
