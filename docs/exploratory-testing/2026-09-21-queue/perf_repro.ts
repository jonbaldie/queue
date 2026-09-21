// Perf evidence for #125: RateLimiter.isAllowed per-request cost must be
// independent of RATE_LIMIT_REQUESTS (window length).
import { RateLimiter } from "../../../src/rate_limiter.ts";

function bench(limit: number, requests: number): number {
  const limiter = new RateLimiter(limit, 60000, 1_000_000, 10_000);
  const makeReq = () =>
    new Request("http://localhost/length/q", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });

  // Warmup
  for (let i = 0; i < limit; i++) limiter.isAllowed(makeReq());

  const start = performance.now();
  for (let i = 0; i < requests; i++) {
    limiter.isAllowed(makeReq()); // all denied: at limit
  }
  return (performance.now() - start) / requests; // ms per request
}

// Fill a window of `limit`, then time denied requests. Compare limit=1000 vs 10000.
const perReqSmall = bench(1_000, 2_000);
const perReqLarge = bench(10_000, 2_000);

console.log(`limit=1,000: ${perReqSmall.toFixed(4)} ms/req`);
console.log(`limit=10,000: ${perReqLarge.toFixed(4)} ms/req`);

// The bug: cost grows linearly with window length (10x limit → ~10x cost).
const ratio = perReqLarge / perReqSmall;
console.log(
  `ratio: ${ratio.toFixed(2)}x (buggy ≈ 10x, fixed ≈ 1x)`,
);

// Red-capable assertion: per-request cost must not grow with the window.
if (ratio > 3) {
  console.error(
    `RED: per-request cost scales with window (ratio=${
      ratio.toFixed(2)
    })`,
  );
  Deno.exit(1);
}
console.log("GREEN: per-request cost is window-independent");
