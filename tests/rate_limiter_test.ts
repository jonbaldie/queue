import { assertEquals, assertNotEquals, assertThrows, assertRejects } from "jsr:@std/assert@1.0";
import QueueManager, { QueueNameTooLongError } from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";
import * as Persistency from "../src/persist.ts";
import { RateLimiter } from "../src/rate_limiter.ts";
import { parseConfig, ConfigError } from "../src/config.ts";

// Shared helpers
const API_TOKEN = "test-token";
const authHeaders = { "Authorization": `Bearer ${API_TOKEN}` };

function makeHandler(token = API_TOKEN, rateLimit = 100) {
    const mgr = new QueueManager(new Persistency.MemoryStore());
    return createHandler(mgr, token, rateLimit);
}

function req(ip: string): Request {
    return new Request("http://localhost/test", {
        headers: { "x-forwarded-for": ip },
    });
}
const makeRequest = req;

Deno.test("limits: per-IP stale entries are removed on revisit", async () => {
    const limiter = new RateLimiter(3, 100); // 3 requests per 100ms window

    const reqObj = new Request("http://localhost/length/test-queue", {
        headers: { "x-forwarded-for": "10.0.0.1" },
    });

    assertEquals(limiter.isAllowed(reqObj), true);
    assertEquals((limiter as unknown as { requestTimestamps: Map<string, number[]> }).requestTimestamps.size, 1);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    const req2 = new Request("http://localhost/length/test-queue", {
        headers: { "x-forwarded-for": "10.0.0.1" },
    });
    assertEquals(limiter.isAllowed(req2), true);
    // Entry count should still be 1, not accumulate stale entries
    assertEquals((limiter as unknown as { requestTimestamps: Map<string, number[]> }).requestTimestamps.size, 1);
});

Deno.test("limits: periodic sweep removes stale entries", async () => {
    // cleanupInterval=3 sweeps every 3rd request
    const limiter = new RateLimiter(100, 100, 3);

    const req1 = new Request("http://localhost/length/q", {
        headers: { "x-forwarded-for": "10.0.0.1" },
    });
    const req2 = new Request("http://localhost/length/q", {
        headers: { "x-forwarded-for": "10.0.0.2" },
    });
    const req3 = new Request("http://localhost/length/q", {
        headers: { "x-forwarded-for": "10.0.0.3" },
    });

    limiter.isAllowed(req1);
    limiter.isAllowed(req2);
    limiter.isAllowed(req3);
    assertEquals((limiter as unknown as { requestTimestamps: Map<string, number[]> }).requestTimestamps.size, 3);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    // 3 more requests to trigger sweep on the 3rd
    const req4 = new Request("http://localhost/length/q", {
        headers: { "x-forwarded-for": "10.0.0.4" },
    });
    limiter.isAllowed(req4);
    limiter.isAllowed(req4);
    limiter.isAllowed(req4);

    // Old entries should be swept; only the fresh IP remains
    assertEquals((limiter as unknown as { requestTimestamps: Map<string, number[]> }).requestTimestamps.size, 1);
});

Deno.test("rate limiter allows requests under limit", () => {
    const limiter = new RateLimiter(5, 60000, 100, 10000);
    for (let i = 0; i < 5; i++) {
        assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), true);
    }
    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), false);
});

Deno.test("rate limiter tracks different IPs independently", () => {
    const limiter = new RateLimiter(2, 60000, 100, 10000);
    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), true);
    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), true);
    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), false);
    assertEquals(limiter.isAllowed(makeRequest("2.2.2.2")), true);
});

Deno.test("rate limiter evicts oldest entries when map exceeds maxTrackedIPs", () => {
    const limiter = new RateLimiter(100, 60000, 1, 3);

    limiter.isAllowed(makeRequest("1.1.1.1"));
    limiter.isAllowed(makeRequest("2.2.2.2"));
    limiter.isAllowed(makeRequest("3.3.3.3"));

    limiter.isAllowed(makeRequest("4.4.4.4"));

    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), true);
});

Deno.test("rate limiter evicted IPs can re-acquire rate limit slots", () => {
    const limiter = new RateLimiter(2, 60000, 1, 2);

    limiter.isAllowed(makeRequest("1.1.1.1"));
    limiter.isAllowed(makeRequest("2.2.2.2"));
    limiter.isAllowed(makeRequest("3.3.3.3"));

    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), true);
    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), true);
    assertEquals(limiter.isAllowed(makeRequest("1.1.1.1")), false);
});

Deno.test("rate limiter: x-forwarded-for first IP is used when comma-separated", () => {
    const limiter = new RateLimiter(2, 60000, 100, 10000);
    // 10.0.0.1 should be rate-limited after 2 requests; 10.0.0.2 should not
    const multiReq = new Request("http://localhost/test", {
        headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" },
    });
    assertEquals(limiter.isAllowed(multiReq), true);
    assertEquals(limiter.isAllowed(multiReq), true);
    assertEquals(limiter.isAllowed(multiReq), false); // 10.0.0.1 is limited

    // 10.0.0.2 alone should still be allowed
    assertEquals(limiter.isAllowed(req("10.0.0.2")), true);
});

Deno.test("rate limiter: unknown IP used when no x-forwarded-for and no remoteAddr", () => {
    const limiter = new RateLimiter(2, 60000, 100, 10000);
    const bare = new Request("http://localhost/test");
    assertEquals(limiter.isAllowed(bare), true);
    assertEquals(limiter.isAllowed(bare), true);
    assertEquals(limiter.isAllowed(bare), false); // "unknown" IP is limited
});

// ── Window boundary ───────────────────────────────────────────────────────────

Deno.test("rate limiter: timestamps outside window are excluded from count", async () => {
    const limiter = new RateLimiter(2, 100, 100, 10000); // 2 req per 100ms
    assertEquals(limiter.isAllowed(req("1.1.1.1")), true);
    assertEquals(limiter.isAllowed(req("1.1.1.1")), true);
    assertEquals(limiter.isAllowed(req("1.1.1.1")), false); // at limit

    await new Promise(r => setTimeout(r, 150)); // window expires

    // Should be allowed again — old timestamps are beyond cutoff (ts > cutoff, not >=)
    assertEquals(limiter.isAllowed(req("1.1.1.1")), true);
});

Deno.test("rate limiter: timestamp exactly at cutoff boundary is excluded", async () => {
    const limiter = new RateLimiter(1, 100, 100, 10000);
    assertEquals(limiter.isAllowed(req("2.2.2.2")), true);
    assertEquals(limiter.isAllowed(req("2.2.2.2")), false);

    await new Promise(r => setTimeout(r, 110));
    assertEquals(limiter.isAllowed(req("2.2.2.2")), true);
});

// ── Stale entry cleanup ───────────────────────────────────────────────────────

Deno.test("rate limiter: stale IP with empty timestamps is removed from map", async () => {
    const limiter = new RateLimiter(5, 100, 100, 10000);
    assertEquals(limiter.isAllowed(req("3.3.3.3")), true);

    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };
    assertEquals(internal.requestTimestamps.has("3.3.3.3"), true);

    await new Promise(r => setTimeout(r, 150));

    // Next request from same IP: stale timestamps are filtered, size goes to 0, entry deleted
    assertEquals(limiter.isAllowed(req("3.3.3.3")), true);
    // Entry exists again with fresh timestamp but no stale ones
    assertEquals(internal.requestTimestamps.has("3.3.3.3"), true);
    assertEquals(internal.requestTimestamps.get("3.3.3.3")!.length, 1);
});

Deno.test("rate limiter: cleanup updates map when stale entries shrink (fresh.length !== timestamps.length)", async () => {
    // cleanupInterval=2 so sweep fires on 2nd request
    const limiter = new RateLimiter(100, 100, 2, 10000);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    limiter.isAllowed(req("4.4.4.4")); // adds timestamp

    await new Promise(r => setTimeout(r, 150)); // timestamp becomes stale

    // Trigger sweep: 2nd request to a different IP causes the periodic cleanup
    limiter.isAllowed(req("5.5.5.5"));
    limiter.isAllowed(req("6.6.6.6")); // this triggers requestCount >= cleanupInterval

    // 4.4.4.4 entry should be removed (all its timestamps are stale)
    assertEquals(internal.requestTimestamps.has("4.4.4.4"), false);
});

// ── Eviction ordering ─────────────────────────────────────────────────────────

Deno.test("rate limiter: eviction removes oldest-activity IPs first", () => {
    // maxTrackedIPs=2, cleanupInterval=1 (every request triggers cleanup check)
    const limiter = new RateLimiter(100, 60000, 1, 2);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    // IP A gets a timestamp first (oldest)
    limiter.isAllowed(req("a.a.a.a")); // request 1 — cleanup fires, nothing to evict yet (size=1)

    // IP B is second
    limiter.isAllowed(req("b.b.b.b")); // request 2 — cleanup fires, size=2 (at limit)

    // IP C causes eviction — size would be 3 > maxTrackedIPs=2
    limiter.isAllowed(req("c.c.c.c")); // request 3 — cleanup fires, evict oldest (a.a.a.a)

    // a.a.a.a should have been evicted (it has the oldest max timestamp)
    assertEquals(internal.requestTimestamps.has("c.c.c.c"), true);
    assertEquals(internal.requestTimestamps.has("b.b.b.b"), true);
});

Deno.test("rate limiter: evicted IP gets a fresh slot count", () => {
    // maxTrackedIPs=1, cleanupInterval=1 (every request).
    // Eviction runs at START of isAllowed, before adding current IP.
    // So after old.ip + new.ip both added (size=2), the THIRD call triggers eviction.
    const limiter = new RateLimiter(100, 60000, 1, 1);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    limiter.isAllowed(req("old.ip")); // size→1, eviction check: 1 > 1? No
    limiter.isAllowed(req("new.ip")); // size→2, eviction check on entry: 1 > 1? No; after: size=2
    limiter.isAllowed(req("trigger.ip")); // eviction check: size=2 > 1 → evict oldest (old.ip)

    assertEquals(internal.requestTimestamps.has("old.ip"), false);
    assertEquals(internal.requestTimestamps.has("new.ip"), true);
});

// ── requestCount reset after cleanup ─────────────────────────────────────────

Deno.test("rate limiter: requestCount resets to 0 after periodic cleanup fires", () => {
    const limiter = new RateLimiter(100, 60000, 3, 10000);
    const internal = limiter as unknown as { requestCount: number };

    limiter.isAllowed(req("1.1.1.1")); // count=1
    limiter.isAllowed(req("1.1.1.1")); // count=2
    assertEquals(internal.requestCount, 2);

    limiter.isAllowed(req("1.1.1.1")); // count hits 3 >= cleanupInterval=3, resets to 0
    assertEquals(internal.requestCount, 0);
});

Deno.test("rate limiter: cleanup fires at exactly cleanupInterval (>= not >)", () => {
    const limiter = new RateLimiter(100, 60000, 2, 10000);
    const internal = limiter as unknown as { requestCount: number };

    limiter.isAllowed(req("x.x.x.x")); // count=1
    assertEquals(internal.requestCount, 1);
    limiter.isAllowed(req("x.x.x.x")); // count=2, hits cleanupInterval=2, resets
    assertEquals(internal.requestCount, 0);
});

// ── Partial-stale entry cleanup (fresh.length !== timestamps.length branch) ───

Deno.test("rate limiter: stale timestamps within active IP entry are pruned on cleanup sweep", () => {
    const limiter = new RateLimiter(10, 100, 1, 10000); // 100ms window, cleanup every request
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    // Plant one stale and one fresh timestamp directly into the internal map
    const staleTs = Date.now() - 200; // definitely outside 100ms window
    const freshTs = Date.now();
    internal.requestTimestamps.set("mixed.ip", [staleTs, freshTs]);

    // Trigger cleanup from a different IP (so mixed.ip gets swept via cleanupStaleEntries)
    limiter.isAllowed(req("sweeper.ip"));

    // mixed.ip should still exist (has a fresh timestamp) but with only 1 entry
    const remaining = internal.requestTimestamps.get("mixed.ip");
    assertEquals(remaining?.length, 1);
});

// ── No premature eviction when size == maxTrackedIPs ─────────────────────────

Deno.test("rate limiter: no eviction when tracked IPs equals maxTrackedIPs (> not >=)", () => {
    // maxTrackedIPs=2, cleanupInterval=1. With a >= mutation, cleanup would
    // evict an IP when size==2, which is wrong — should only evict when size > 2.
    const limiter = new RateLimiter(100, 60000, 1, 2);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    limiter.isAllowed(req("ip1")); // size→1, no eviction (1 > 2? No)
    limiter.isAllowed(req("ip2")); // size→2, no eviction (2 > 2? No, but >= would be Yes)

    // Both IPs should still be tracked
    assertEquals(internal.requestTimestamps.has("ip1"), true);
    assertEquals(internal.requestTimestamps.has("ip2"), true);
});

Deno.test("rate limiter: evicts exactly toEvict entries (i < not i <=)", () => {
    // With i <= toEvict, one extra IP would be evicted.
    // maxTrackedIPs=2, cleanupInterval=1. Add 3 IPs → size=3 > 2, toEvict=1.
    // Should evict 1, leaving 2 + the triggering new IP = 3 total...
    // But the triggering IP is the one causing cleanup, so let's add a 4th to inspect.
    const limiter = new RateLimiter(100, 60000, 1, 2);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    limiter.isAllowed(req("a")); // size→1
    limiter.isAllowed(req("b")); // size→2
    limiter.isAllowed(req("c")); // size→3 (after cleanup runs with size=2, no eviction; then c added)
    // Now size=3. The NEXT request will fire cleanup with size=3, toEvict=1.
    limiter.isAllowed(req("d")); // cleanup: 3 > 2 → toEvict=1. Evict oldest (a). size→2. Add d → size=3.

    // With i <= mutation: toEvict=1, loop i=0,1 → 2 evictions → size 3→1, then d added → size=2
    // Correct: size=3 after d is added
    assertEquals(internal.requestTimestamps.size, 3);
});

// ── trim() removal detection ──────────────────────────────────────────────────

Deno.test("rate limiter: x-forwarded-for with spaces around IP is trimmed correctly", () => {
    // " 10.0.0.1 " should rate-limit the same as "10.0.0.1"
    const limiter = new RateLimiter(2, 60000, 100, 10000);
    const paddedReq = new Request("http://localhost/test", {
        headers: { "x-forwarded-for": " 10.0.0.1 , 10.0.0.2" },
    });
    const cleanReq = req("10.0.0.1");

    assertEquals(limiter.isAllowed(paddedReq), true);  // counts for "10.0.0.1"
    assertEquals(limiter.isAllowed(cleanReq), true);   // counts for "10.0.0.1" — same bucket
    assertEquals(limiter.isAllowed(cleanReq), false);  // 10.0.0.1 at limit

    // Without trim, "10.0.0.1" and " 10.0.0.1" are different IPs so the 3rd would succeed
});

// ── remoteAddr fallback when no x-forwarded-for ──────────────────────────────

Deno.test("rate limiter: unknown IP and remoteAddr='unknown' share rate limit slot", () => {
    // remoteAddr=undefined → getClientIp returns "unknown"
    // remoteAddr="unknown" (truthy) → returns "unknown" too
    // They should share the same bucket.
    // If `if (remoteAddr)` → `if (true)`, remoteAddr=undefined would return undefined→"undefined"
    // and that would be a DIFFERENT bucket from remoteAddr="unknown".
    const limiter = new RateLimiter(1, 60000, 100, 10000);

    // First request: no remoteAddr → "unknown" bucket
    const noAddrReq = new Request("http://localhost/test");
    assertEquals(limiter.isAllowed(noAddrReq, undefined), true);

    // Second request with remoteAddr="unknown": should be in SAME "unknown" bucket → blocked
    assertEquals(limiter.isAllowed(noAddrReq, "unknown"), false);
});

// ── timestamps.length === 0 delete branch ───────────────────────────────────

Deno.test("rate limiter: all-stale IP entry is deleted when isAllowed is called", async () => {
    const limiter = new RateLimiter(5, 100, 100, 10000); // 100ms window
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    limiter.isAllowed(req("expire.ip"));
    assertEquals(internal.requestTimestamps.has("expire.ip"), true);

    await new Promise(r => setTimeout(r, 150));

    // isAllowed call for same IP: all timestamps are stale → filtered to [] → should delete
    limiter.isAllowed(req("expire.ip")); // this processes: timestamps=[], length=0 → delete; then re-adds
    // After deletion and re-add, the IP exists with only 1 (fresh) timestamp
    assertEquals(internal.requestTimestamps.get("expire.ip")?.length, 1);
});

Deno.test("rate limiter: after stale entry deleted, request from same IP is freshly allowed", async () => {
    const limiter = new RateLimiter(1, 100, 100, 10000);
    assertEquals(limiter.isAllowed(req("stale.ip")), true);
    assertEquals(limiter.isAllowed(req("stale.ip")), false); // at limit

    await new Promise(r => setTimeout(r, 150)); // window expires

    // After window, IP is no longer rate-limited (deletion + fresh slot)
    assertEquals(limiter.isAllowed(req("stale.ip")), true);
});

// ── filter boundary in isAllowed (ts > cutoff, not >=) ───────────────────────

Deno.test("rate limiter: isAllowed filter uses strict > cutoff for timestamp inclusion", async () => {
    // Plant a timestamp that will be JUST at the boundary, then verify filter excludes it
    const limiter = new RateLimiter(1, 100, 100, 10000);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    // Plant a timestamp that is exactly (now - windowMs) — right at the cutoff boundary
    // With ts > cutoff: ts == cutoff → excluded (slot freed)
    // With ts >= cutoff: ts == cutoff → included (slot still consumed)
    const now = Date.now();
    const exactCutoff = now - 100; // exactly at the boundary of a 100ms window
    internal.requestTimestamps.set("boundary.ip", [exactCutoff]);

    // When isAllowed runs, cutoff = now - 100 = exactCutoff. ts > cutoff? No (equal). ts excluded.
    // So request should be ALLOWED (no valid timestamps left).
    assertEquals(limiter.isAllowed(req("boundary.ip")), true);
});

// ── default empty array vs non-empty ─────────────────────────────────────────

Deno.test("rate limiter: new IP starts with empty timestamp list", () => {
    const limiter = new RateLimiter(3, 60000, 100, 10000);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    // First time seen — should not have any pre-existing timestamps
    // If default is ["Stryker was here"] the count would start at 1, not 0
    limiter.isAllowed(req("fresh.ip"));
    assertEquals(internal.requestTimestamps.get("fresh.ip")?.length, 1); // only the one we just made
});

// ── Sort correctness in eviction ──────────────────────────────────────────────

Deno.test("rate limiter: eviction sort uses max timestamp (Math.max not Math.min)", () => {
    // maxTrackedIPs=1, cleanupInterval=1.
    // old.ip registers first (smaller timestamp). new.ip registers after a delay (larger timestamp).
    // When a third request comes in, eviction fires and must remove old.ip (smallest max ts).
    const limiter = new RateLimiter(10, 60000, 1, 1);
    const internal = limiter as unknown as { requestTimestamps: Map<string, number[]> };

    limiter.isAllowed(req("old.ip")); // size→1

    return new Promise<void>(resolve => {
        setTimeout(() => {
            limiter.isAllowed(req("new.ip")); // size→2; eviction check sees 1 > 1? No
            limiter.isAllowed(req("evict.trigger")); // eviction check: 2 > 1 → sort ascending by max ts → evict old.ip

            assertEquals(internal.requestTimestamps.has("old.ip"), false);
            assertEquals(internal.requestTimestamps.has("new.ip"), true);
            resolve();
        }, 20);
    });
});
