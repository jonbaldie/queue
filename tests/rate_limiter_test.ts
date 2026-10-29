import { assertEquals } from "jsr:@std/assert@1.0";
import { RateLimiter } from "../src/rate_limiter.ts";

Deno.test("rate limiter: opaque keys have independent limits and tracked count", () => {
    const limiter = new RateLimiter(1);
    assertEquals(limiter.trackedKeysCount, 0);
    assertEquals(limiter.isAllowed("tenant:a", 1000), true);
    assertEquals(limiter.isAllowed("tenant:a", 1000), false);
    assertEquals(limiter.isAllowed("tenant:b", 1000), true);
    assertEquals(limiter.trackedKeysCount, 2);
});

Deno.test("rate limiter: equal timestamps count and exact cutoff expires", () => {
    const limiter = new RateLimiter(2, 100);
    assertEquals(limiter.isAllowed("a", 1000), true);
    assertEquals(limiter.isAllowed("a", 1000), true);
    assertEquals(limiter.isAllowed("a", 1099), false);
    assertEquals(limiter.isAllowed("a", 1100), true);
    assertEquals(limiter.isAllowed("a", 1100), true);
    assertEquals(limiter.isAllowed("a", 1100), false);
});

Deno.test("rate limiter: denied calls do not extend the window", () => {
    const limiter = new RateLimiter(1, 100);
    assertEquals(limiter.isAllowed("a", 0), true);
    assertEquals(limiter.isAllowed("a", 99), false);
    assertEquals(limiter.isAllowed("a", 100), true);
    assertEquals(limiter.isAllowed("a", 101), false);
});

Deno.test("rate limiter: stale prefix is excluded even when fresh entries remain", () => {
    const limiter = new RateLimiter(4, 100, 1000);
    for (const now of [0, 1, 50, 51]) assertEquals(limiter.isAllowed("a", now), true);
    assertEquals(limiter.isAllowed("a", 100), true);
    assertEquals(limiter.isAllowed("a", 100), false);
    assertEquals(limiter.isAllowed("a", 101), true);
    assertEquals(limiter.isAllowed("a", 101), false);
    assertEquals(limiter.isAllowed("a", 150), true);
});

Deno.test("rate limiter: periodic sweep removes stale keys at the cutoff", () => {
    const limiter = new RateLimiter(1, 100, 3);
    assertEquals(limiter.isAllowed("old", 0), true);
    assertEquals(limiter.isAllowed("fresh", 50), true);
    assertEquals(limiter.trackedKeysCount, 2);
    assertEquals(limiter.isAllowed("trigger", 100), true);
    assertEquals(limiter.trackedKeysCount, 2);
    assertEquals(limiter.isAllowed("fresh", 100), false);
    assertEquals(limiter.isAllowed("old", 100), true);
});

Deno.test("rate limiter: denied calls count toward sweep interval", () => {
    const limiter = new RateLimiter(1, 100, 3);
    assertEquals(limiter.isAllowed("old", 0), true);
    assertEquals(limiter.isAllowed("active", 99), true);
    assertEquals(limiter.isAllowed("active", 100), false);
    assertEquals(limiter.trackedKeysCount, 1);
});

Deno.test("rate limiter: sweep evicts oldest last activity only above cap", () => {
    const limiter = new RateLimiter(2, 1000, 5, 2);
    assertEquals(limiter.isAllowed("a", 0), true);
    assertEquals(limiter.isAllowed("b", 1), true);
    assertEquals(limiter.isAllowed("a", 2), true);
    assertEquals(limiter.isAllowed("c", 3), true);
    assertEquals(limiter.trackedKeysCount, 3);
    assertEquals(limiter.isAllowed("trigger", 4), true);
    assertEquals(limiter.trackedKeysCount, 3);
    assertEquals(limiter.isAllowed("a", 5), false);
    assertEquals(limiter.isAllowed("b", 6), true);
});

Deno.test("rate limiter: sweep prunes a mixed stale and fresh key", () => {
    const limiter = new RateLimiter(2, 100, 3);
    assertEquals(limiter.isAllowed("a", 0), true);
    assertEquals(limiter.isAllowed("a", 50), true);
    assertEquals(limiter.isAllowed("trigger", 100), true);
    assertEquals(limiter.isAllowed("a", 100), true);
    assertEquals(limiter.isAllowed("a", 100), false);
    assertEquals(limiter.isAllowed("a", 150), true);
});

Deno.test("rate limiter: large window and stale prefix retain correct limits", () => {
    const limiter = new RateLimiter(10_000, 60_000, 100_000);
    for (let i = 0; i < 10_000; i++) assertEquals(limiter.isAllowed("bulk", i), true);
    assertEquals(limiter.isAllowed("bulk", 10_000), false);
    for (let i = 0; i < 5000; i++) assertEquals(limiter.isAllowed("bulk", 60_000 + i), true);
    assertEquals(limiter.isAllowed("bulk", 64_999), false);
    assertEquals(limiter.isAllowed("bulk", 70_000), true);
});

Deno.test("rate limiter: denied requests at a full window are cheap", () => {
    const limiter = new RateLimiter(10_000, 600_000, 100_000);
    for (let i = 0; i < 10_000; i++) limiter.isAllowed("perf", 0);
    const start = performance.now();
    for (let i = 0; i < 2_000; i++) assertEquals(limiter.isAllowed("perf", 1), false);
    const elapsed = performance.now() - start;
    assertEquals(elapsed < 80, true, `2,000 denied requests took ${elapsed.toFixed(1)}ms`);
});

Deno.test("rate limiter: sweep evicts multiple least recently active keys", () => {
    const limiter = new RateLimiter(1, 1000, 5, 1);
    for (const [key, now] of [["a", 0], ["b", 1], ["c", 2], ["d", 3]] as const) {
        assertEquals(limiter.isAllowed(key, now), true);
    }
    assertEquals(limiter.trackedKeysCount, 4);
    assertEquals(limiter.isAllowed("trigger", 4), true);
    assertEquals(limiter.trackedKeysCount, 2);
    assertEquals(limiter.isAllowed("d", 5), false);
    assertEquals(limiter.isAllowed("a", 6), true);
    assertEquals(limiter.isAllowed("b", 7), true);
    assertEquals(limiter.isAllowed("c", 8), true);
});

Deno.test("rate limiter: active and swept keys bound retention and allocation", async () => {
    const canary = new URL("./fixtures/rate_limiter_retention.ts", import.meta.url);
    const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-env", "--v8-flags=--expose-gc", canary.pathname],
        stdout: "piped",
        stderr: "piped",
    }).output();
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    assertEquals(result.code, 0, output);
});

Deno.test("rate limiter: sweep expires only keys at or before cutoff and repeats on schedule", () => {
    const limiter = new RateLimiter(1, 100, 4);
    assertEquals(limiter.isAllowed("before", 0), true);
    assertEquals(limiter.isAllowed("at", 1), true);
    assertEquals(limiter.isAllowed("after", 2), true);
    assertEquals(limiter.isAllowed("trigger", 101), true);
    assertEquals(limiter.trackedKeysCount, 2);
    assertEquals(limiter.isAllowed("after", 101), false);
    assertEquals(limiter.isAllowed("trigger", 101), false);
    assertEquals(limiter.isAllowed("next", 101), true);
    assertEquals(limiter.trackedKeysCount, 3);
    assertEquals(limiter.isAllowed("next", 102), false);
    assertEquals(limiter.trackedKeysCount, 2);
    assertEquals(limiter.isAllowed("after", 102), true);
});

Deno.test("rate limiter: window counts timestamps on both sides of the cutoff", () => {
    const limiter = new RateLimiter(5, 100, 1000);
    for (const now of [0, 1, 1, 2, 50]) assertEquals(limiter.isAllowed("a", now), true);
    assertEquals(limiter.isAllowed("a", 100), true);
    assertEquals(limiter.isAllowed("a", 100), false);
    assertEquals(limiter.isAllowed("a", 101), true);
    assertEquals(limiter.isAllowed("a", 101), true);
    assertEquals(limiter.isAllowed("a", 101), false);
    assertEquals(limiter.isAllowed("a", 102), true);
    assertEquals(limiter.isAllowed("a", 102), false);
});
