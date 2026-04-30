import { assertEquals } from "jsr:@std/assert@1.0";
import * as Persistency from "../src/persist.ts";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";
import { RateLimiter } from "../src/rate_limiter.ts";

const TEST_TOKEN = "test-secret-token";

function makeHandler(queueDepthLimit?: number, queueCountLimit?: number, rateLimitRequests?: number) {
    const mgr = new QueueManager(new Persistency.None, queueDepthLimit, queueCountLimit);
    return createHandler(mgr, TEST_TOKEN, rateLimitRequests);
}

// Queue depth limit tests
Deno.test("limits: enqueue beyond queue depth limit returns 507", async () => {
    const DEPTH_LIMIT = 5;
    const handler = makeHandler(DEPTH_LIMIT, undefined, undefined);

    // Fill the queue to the limit
    for (let i = 0; i < DEPTH_LIMIT; i++) {
        const req = new Request("http://localhost/enqueue/test-queue", {
            method: "POST",
            body: JSON.stringify({ payload: `item-${i}` }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        });
        const res = await handler(req);
        assertEquals(200, res.status, `Item ${i} should enqueue successfully`);
    }

    // Try to enqueue one more - should return 507
    const overflowReq = new Request("http://localhost/enqueue/test-queue", {
        method: "POST",
        body: JSON.stringify({ payload: "overflow-item" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TEST_TOKEN}`,
        },
    });
    const overflowRes = await handler(overflowReq);
    assertEquals(507, overflowRes.status, "Enqueue beyond depth limit should return 507");
});

// Queue count limit tests
Deno.test("limits: create beyond queue count limit returns 507", async () => {
    const COUNT_LIMIT = 3;
    const handler = makeHandler(undefined, COUNT_LIMIT, undefined);

    // Create queues up to the limit
    for (let i = 0; i < COUNT_LIMIT; i++) {
        const req = new Request(`http://localhost/enqueue/queue-${i}`, {
            method: "POST",
            body: JSON.stringify({ payload: `item` }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        });
        const res = await handler(req);
        assertEquals(200, res.status, `Queue ${i} should be created successfully`);
    }

    // Try to create one more queue - should return 507
    const overflowReq = new Request("http://localhost/enqueue/queue-overflow", {
        method: "POST",
        body: JSON.stringify({ payload: "item" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TEST_TOKEN}`,
        },
    });
    const overflowRes = await handler(overflowReq);
    assertEquals(507, overflowRes.status, "Creating beyond queue count limit should return 507");
});

// Rate limit tests
Deno.test("limits: exceed rate limit returns 429", async () => {
    const RATE_LIMIT = 3; // 3 requests per minute
    const handler = makeHandler(undefined, undefined, RATE_LIMIT);

    // Make requests up to the limit from the same IP
    for (let i = 0; i < RATE_LIMIT; i++) {
        const req = new Request("http://localhost/length/test-queue", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        });
        const res = await handler(req);
        assertEquals(200, res.status, `Request ${i} should succeed`);
    }

    // One more request should be rate limited
    const rateLimitedReq = new Request("http://localhost/length/test-queue", {
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
    });
    const rateLimitedRes = await handler(rateLimitedReq);
    assertEquals(429, rateLimitedRes.status, "Exceeding rate limit should return 429");
});

// Different IPs should have separate rate limits
Deno.test("limits: rate limit is per-IP", async () => {
    const RATE_LIMIT = 2;
    const handler = makeHandler(undefined, undefined, RATE_LIMIT);

    // Make 2 requests from IP1
    for (let i = 0; i < RATE_LIMIT; i++) {
        const req = new Request("http://localhost/length/test-queue", {
            headers: {
                "Authorization": `Bearer ${TEST_TOKEN}`,
                "x-forwarded-for": "192.168.1.1",
            },
        });
        const res = await handler(req);
        assertEquals(200, res.status, `IP1 request ${i} should succeed`);
    }

    // IP1 is now rate limited
    const ip1LimitedReq = new Request("http://localhost/length/test-queue", {
        headers: {
            "Authorization": `Bearer ${TEST_TOKEN}`,
            "x-forwarded-for": "192.168.1.1",
        },
    });
    const ip1LimitedRes = await handler(ip1LimitedReq);
    assertEquals(429, ip1LimitedRes.status, "IP1 should be rate limited");

    // But IP2 should still be able to make requests
    const ip2Req = new Request("http://localhost/length/test-queue", {
        headers: {
            "Authorization": `Bearer ${TEST_TOKEN}`,
            "x-forwarded-for": "192.168.1.2",
        },
    });
    const ip2Res = await handler(ip2Req);
    assertEquals(200, ip2Res.status, "IP2 should not be rate limited");
});

// Memory leak fix tests for RateLimiter cleanup
Deno.test("limits: per-IP stale entries are removed on revisit", async () => {
    const limiter = new RateLimiter(3, 100); // 3 requests per 100ms window

    const req = new Request("http://localhost/length/test-queue", {
        headers: { "x-forwarded-for": "10.0.0.1" },
    });

    assertEquals(limiter.isAllowed(req), true);
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

// Non-proxied requests should use remote address for rate limiting
Deno.test("limits: rate limit is per-remote-address for non-proxied requests", async () => {
    const RATE_LIMIT = 2;
    const handler = makeHandler(undefined, undefined, RATE_LIMIT);

    // Make 2 requests from client1 without x-forwarded-for
    for (let i = 0; i < RATE_LIMIT; i++) {
        const req = new Request("http://localhost/length/test-queue", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        });
        const res = await handler(req, { remoteAddr: { hostname: "192.168.1.10", port: 12345, transport: "tcp" }, completed: Promise.resolve() });
        assertEquals(200, res.status, `Client1 request ${i} should succeed`);
    }

    // Client1 is now rate limited
    const client1LimitedReq = new Request("http://localhost/length/test-queue", {
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
    });
    const client1LimitedRes = await handler(client1LimitedReq, { remoteAddr: { hostname: "192.168.1.10", port: 12345, transport: "tcp" }, completed: Promise.resolve() });
    assertEquals(429, client1LimitedRes.status, "Client1 should be rate limited");

    // But client2 should still be able to make requests
    const client2Req = new Request("http://localhost/length/test-queue", {
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
    });
    const client2Res = await handler(client2Req, { remoteAddr: { hostname: "192.168.1.11", port: 12346, transport: "tcp" }, completed: Promise.resolve() });
    assertEquals(200, client2Res.status, "Client2 should not be rate limited");
});

// x-forwarded-for should take precedence over remote address
Deno.test("limits: x-forwarded-for takes precedence over remote address", async () => {
    const RATE_LIMIT = 2;
    const handler = makeHandler(undefined, undefined, RATE_LIMIT);

    // Make 2 requests with x-forwarded-for
    for (let i = 0; i < RATE_LIMIT; i++) {
        const req = new Request("http://localhost/length/test-queue", {
            headers: {
                "Authorization": `Bearer ${TEST_TOKEN}`,
                "x-forwarded-for": "10.0.0.1",
            },
        });
        const res = await handler(req, { remoteAddr: { hostname: "192.168.1.1", port: 12345, transport: "tcp" }, completed: Promise.resolve() });
        assertEquals(200, res.status, `Forwarded request ${i} should succeed`);
    }

    // Rate limited based on x-forwarded-for, not remoteAddr
    const limitedReq = new Request("http://localhost/length/test-queue", {
        headers: {
            "Authorization": `Bearer ${TEST_TOKEN}`,
            "x-forwarded-for": "10.0.0.1",
        },
    });
    const limitedRes = await handler(limitedReq, { remoteAddr: { hostname: "192.168.1.99", port: 12345, transport: "tcp" }, completed: Promise.resolve() });
    assertEquals(429, limitedRes.status, "Should be rate limited by x-forwarded-for");

    // Different x-forwarded-for should not be rate limited even with same remoteAddr
    const otherReq = new Request("http://localhost/length/test-queue", {
        headers: {
            "Authorization": `Bearer ${TEST_TOKEN}`,
            "x-forwarded-for": "10.0.0.2",
        },
    });
    const otherRes = await handler(otherReq, { remoteAddr: { hostname: "192.168.1.1", port: 12345, transport: "tcp" }, completed: Promise.resolve() });
    assertEquals(200, otherRes.status, "Different forwarded IP should not be rate limited");
});
