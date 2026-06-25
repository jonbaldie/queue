// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1.0";
import { RateLimiter } from "../src/rate_limiter.ts";

function makeRequest(ip: string): Request {
    return new Request("http://localhost/test", {
        headers: { "x-forwarded-for": ip },
    });
}

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
