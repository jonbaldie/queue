// Run with: deno run --v8-flags=--expose-gc docs/exploratory-testing/2026-09-21-queue/retention_canary.ts
// This is a resource canary, not a wall-clock benchmark. Run in a fresh process.
import { RateLimiter } from "../../../src/rate_limiter.ts";

declare global {
  var gc: (() => void) | undefined;
}

if (!globalThis.gc) throw new Error("Run with --v8-flags=--expose-gc");
const collect = globalThis.gc;

function checkRetention(cleanupInterval: number): void {
  const limiter = new RateLimiter(1_001, 1_000, cleanupInterval);
  // This idle key must disappear when periodic sweeps are enabled.
  if (!limiter.isAllowed("idle", 0)) throw new Error("idle request denied");
  collect();
  const before = Deno.memoryUsage().heapUsed;
  // One request per time unit keeps 1,000 timestamps fresh while the key
  // remains active. An unbounded stale prefix retains millions of timestamps.
  for (let now = 1; now <= 2_000_000; now++) {
    if (!limiter.isAllowed("active", now)) throw new Error(`denied at ${now}`);
  }
  collect();
  const retained = Deno.memoryUsage().heapUsed - before;
  const expectedKeys = cleanupInterval < 2_000_000 ? 1 : 2;
  if (limiter.trackedKeysCount !== expectedKeys) {
    throw new Error(`sweep interval ${cleanupInterval}: unexpected tracked keys`);
  }
  console.log(`sweep interval ${cleanupInterval}: ${(retained / 1024 / 1024).toFixed(2)} MiB retained`);
  if (retained > 4 * 1024 * 1024) {
    throw new Error(`sweep interval ${cleanupInterval}: retained heap exceeds 4 MiB`);
  }
}

const failures: unknown[] = [];
for (const interval of [10_000_000, 500]) {
  try {
    checkRetention(interval);
  } catch (error) {
    console.error(error);
    failures.push(error);
  }
}
if (failures.length) throw new Error(`${failures.length} retention scenario(s) failed`);
