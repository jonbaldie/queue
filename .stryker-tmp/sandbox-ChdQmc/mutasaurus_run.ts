// @ts-nocheck
import { Mutasaurus } from "jsr:@mutasaurus/mutasaurus";

const mutasaurus = new Mutasaurus({
  sourceFiles: [
    "./src/queue.ts",
    "./src/manager.ts",
    "./src/handler.ts",
    "./src/persist.ts",
    "./src/rate_limiter.ts",
  ],
  testFiles: [
    "./tests/test.ts",
    "./tests/auth_test.ts",
    "./tests/limits_test.ts",
    "./tests/rate_limiter_test.ts",
    "./tests/type_safety_test.ts",
    "./tests/mutation_behavior_test.ts",
  ],
  workers: 4,
  noCheck: true,
  silent: true,
});

const results = await mutasaurus.run(false);

const survived = results.mutations.filter((m: Record<string, unknown>) => m.status === "survived");

console.log(`\nMutation score: ${Math.round(results.killedMutations / results.totalMutations * 100)}%`);
console.log(`Total: ${results.totalMutations} | Killed: ${results.killedMutations} | Survived: ${results.survivedMutations} | Time: ${(results.totalTime / 1000).toFixed(1)}s\n`);
console.log("=== SURVIVED MUTATIONS ===");

for (const m of survived) {
  const original = m.original as { path: string; content: string };
  const shortFile = original.path.replace("/Users/jonathanbaldie/Code/queue/", "");
  const mutatedContent = m.mutation as string;
  const start = m.start as number;

  // Find differing lines
  const origLines = original.content.split("\n");
  const mutLines = mutatedContent.split("\n");
  const diffs: string[] = [];
  for (let i = 0; i < Math.max(origLines.length, mutLines.length); i++) {
    if (origLines[i] !== mutLines[i]) {
      diffs.push(`  line ${i + 1}: "${origLines[i]?.trim()}" → "${mutLines[i]?.trim()}"`);
    }
  }

  console.log(`\n[${shortFile}] operator=${m.operator} start=${start}`);
  for (const d of diffs) console.log(d);
}
