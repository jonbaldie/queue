import { assertEquals, assertNotEquals, assertThrows, assertRejects } from "jsr:@std/assert@1.0";
import QueueManager, { QueueNameTooLongError } from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";
import * as Persistency from "../src/persist.ts";
import { RateLimiter } from "../src/rate_limiter.ts";
import { parseConfig, ConfigError } from "../src/config.ts";

// Shared helpers
const API_TOKEN = "test-token";
const authHeaders = { "Authorization": `Bearer ${API_TOKEN}` };

function makeHandler(queueDepthLimit?: number, queueCountLimit?: number, rateLimitRequests = 100, token = API_TOKEN) {
    const mgr = new QueueManager(new Persistency.MemoryStore(), queueDepthLimit, queueCountLimit);
    return createHandler(mgr, token, rateLimitRequests);
}
const handler = makeHandler();
const auth = authHeaders;


Deno.test("limits: enqueue beyond queue depth limit returns 507", async () => {
    const DEPTH_LIMIT = 5;
    const handler = makeHandler(DEPTH_LIMIT, undefined, undefined, TEST_TOKEN);

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
    const handler = makeHandler(undefined, COUNT_LIMIT, undefined, TEST_TOKEN);

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

Deno.test("limits: reading unknown queues does not exceed queue count limit", async () => {
    const handler = makeHandler(undefined, 1, undefined, API_TOKEN);
    for (const queue of ["a", "b"]) {
        const response = await handler(new Request(`http://localhost/length/${queue}`, {
            headers: authHeaders,
        }));
        assertEquals(response.status, 200);
    }
    const queuesResponse = await handler(new Request("http://localhost/queues", {
        headers: authHeaders,
    }));
    assertEquals(queuesResponse.status, 200);
    const queues = await queuesResponse.json() as string[];
    assertEquals(queues.length <= 1, true);
});

Deno.test("limits: GET /length of an unknown queue does not consume a queue slot", async () => {
    const handler = makeHandler(undefined, 1, undefined, API_TOKEN);
    const lengthRes = await handler(new Request("http://localhost/length/ghost", {
        headers: authHeaders,
    }));
    assertEquals(lengthRes.status, 200);
    assertEquals(await lengthRes.text(), "0");

    const queuesRes = await handler(new Request("http://localhost/queues", {
        headers: authHeaders,
    }));
    assertEquals(await queuesRes.json(), []);

    const enqueueRes = await handler(new Request("http://localhost/enqueue/real", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ payload: "work" }),
    }));
    assertEquals(enqueueRes.status, 200);
});

Deno.test("limits: GET /dequeue of an unknown queue does not consume a queue slot", async () => {
    const handler = makeHandler(undefined, 1, undefined, API_TOKEN);
    const dequeueRes = await handler(new Request("http://localhost/dequeue/ghost", {
        headers: authHeaders,
    }));
    assertEquals(dequeueRes.status, 204);

    const enqueueRes = await handler(new Request("http://localhost/enqueue/real", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ payload: "work" }),
    }));
    assertEquals(enqueueRes.status, 200);
});

// Rate limit tests

Deno.test("limits: exceed rate limit returns 429", async () => {
    const RATE_LIMIT = 3; // 3 requests per minute
    const handler = makeHandler(undefined, undefined, RATE_LIMIT, TEST_TOKEN);

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
    const handler = makeHandler(undefined, undefined, RATE_LIMIT, TEST_TOKEN);

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

Deno.test("limits: rate limit is per-remote-address for non-proxied requests", async () => {
    const RATE_LIMIT = 2;
    const handler = makeHandler(undefined, undefined, RATE_LIMIT, TEST_TOKEN);

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

Deno.test("limits: x-forwarded-for does not bypass the remote-address rate limit", async () => {
    const RATE_LIMIT = 2;
    const handler = makeHandler(undefined, undefined, RATE_LIMIT, TEST_TOKEN);
    const info = {
        remoteAddr: { hostname: "192.168.1.1", port: 12345, transport: "tcp" as const },
        completed: Promise.resolve(),
    };

    for (let i = 0; i < RATE_LIMIT; i++) {
        const req = new Request("http://localhost/length/test-queue", {
            headers: {
                "Authorization": `Bearer ${TEST_TOKEN}`,
                "x-forwarded-for": `203.0.113.${i}`,
            },
        });
        const res = await handler(req, info);
        assertEquals(200, res.status, `Request ${i} should succeed`);
    }

    const limitedReq = new Request("http://localhost/length/test-queue", {
        headers: {
            "Authorization": `Bearer ${TEST_TOKEN}`,
            "x-forwarded-for": "203.0.113.99",
        },
    });
    const limitedRes = await handler(limitedReq, info);
    assertEquals(429, limitedRes.status, "Spoofed X-Forwarded-For must not reset the cap");
});

Deno.test("response body: health returns {status:ok} JSON", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/health"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(await res.json(), { status: "ok" });
});

Deno.test("response body: health POST returns 'Method not allowed'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/health", { method: "POST" }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: unauthorized returns 'Unauthorized'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/q", { method: "POST", body: '{"payload":"x"}' }));
    assertEquals(res.status, 401);
    assertEquals(await res.text(), "Unauthorized");
});

Deno.test("auth: scheme name is case-insensitive per RFC 9110", async () => {
    const handler = makeHandler();
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
        const res = await handler(new Request("http://localhost/queues", {
            headers: { "Authorization": `${scheme} ${API_TOKEN}` },
        }));
        assertEquals(res.status, 200, `scheme "${scheme}" should authenticate`);
    }
});

Deno.test("response body: rate limited returns 'Too many requests'", async () => {
    const handler = makeHandler(undefined, undefined, 1);
    await handler(new Request("http://localhost/length/q", { headers: auth }));
    const res = await handler(new Request("http://localhost/length/q", { headers: auth }));
    assertEquals(res.status, 429);
    assertEquals(await res.text(), "Too many requests");
});

Deno.test("middleware: rate limiting runs before authentication", async () => {
    const handler = makeHandler(undefined, undefined, 1);
    const firstResponse = await handler(new Request("http://localhost/length/q"));
    const secondResponse = await handler(new Request("http://localhost/length/q"));

    assertEquals(firstResponse.status, 401);
    assertEquals(secondResponse.status, 429);
    assertEquals(await secondResponse.text(), "Too many requests");
});

Deno.test("response body: queues POST returns 'Method not allowed'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/queues", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: queues GET returns application/json", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/queues", { headers: auth }));
    assertEquals(res.headers.get("content-type"), "application/json");
});

Deno.test("response body: enqueue POST-only returns 'Method not allowed'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/q", { method: "GET", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: queue name exactly 128 chars is accepted", async () => {
    const handler = makeHandler();
    const name = "a".repeat(128);
    const res = await handler(new Request(`http://localhost/enqueue/${name}`, {
        method: "POST",
        body: '{"payload":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 200);
});

Deno.test("response body: queue name 129 chars returns 'Queue name too long'", async () => {
    const handler = makeHandler();
    const name = "a".repeat(129);
    const res = await handler(new Request(`http://localhost/enqueue/${name}`, {
        method: "POST",
        body: '{"payload":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: queue full returns 'Queue full or too many queues'", async () => {
    const handler = makeHandler(1, undefined);
    await handler(new Request("http://localhost/enqueue/q", { method: "POST", body: '{"payload":"x"}', headers: auth }));
    const res = await handler(new Request("http://localhost/enqueue/q", { method: "POST", body: '{"payload":"y"}', headers: auth }));
    assertEquals(res.status, 507);
    assertEquals(await res.text(), "Queue full or too many queues");
});

Deno.test("response body: large content-length returns 'Payload too large'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":"x"}',
        headers: { ...auth, "content-length": String(1024 * 1024 + 1) },
    }));
    assertEquals(res.status, 413);
    assertEquals(await res.text(), "Payload too large");
});

Deno.test("response body: missing payload key returns 'Missing payload key'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"data":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Missing payload key");
});

Deno.test("response body: null payload returns 'Null payload not allowed'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":null}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Null payload not allowed");
});

Deno.test("response body: invalid JSON returns 'Invalid JSON'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{bad}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Invalid JSON");
});

Deno.test("enqueue of a JSON primitive returns 400 instead of throwing", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: "0",
        headers: auth,
    }));
    assertEquals(res.status, 400);
});

Deno.test("response body: successful enqueue returns queue name in body", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/myqueue", {
        method: "POST",
        body: '{"payload":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "Payload successfully queued onto myqueue.");
});

Deno.test("response body: dequeue POST returns 'Method not allowed'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/dequeue/q", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: dequeue long name returns 'Queue name too long'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request(`http://localhost/dequeue/${"a".repeat(129)}`, { headers: auth }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: dequeue object returns application/json", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":{"key":"val"}}',
        headers: auth,
    }));
    const res = await handler(new Request("http://localhost/dequeue/q", { headers: auth }));
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(await res.json(), { key: "val" });
});

Deno.test("response body: peek POST returns 'Method not allowed'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/peek/q", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: peek long name returns 'Queue name too long'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request(`http://localhost/peek/${"a".repeat(129)}`, { headers: auth }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: peek object returns application/json", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":{"key":"val"}}',
        headers: auth,
    }));
    const res = await handler(new Request("http://localhost/peek/q", { headers: auth }));
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(await res.json(), { key: "val" });
});

Deno.test("response body: length POST returns 'Method not allowed'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/length/q", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: length long name returns 'Queue name too long'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request(`http://localhost/length/${"a".repeat(129)}`, { headers: auth }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: unknown route returns 'Not found.'", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/unknown", { headers: auth }));
    assertEquals(res.status, 404);
    assertEquals(await res.text(), "Not found.");
});

Deno.test("malformed JSON returns 400", async () => {
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: "{invalid json}",
        headers: { ...authHeaders, "content-length": "14" },
    });
    const response = await handler(request);
    assertEquals(response.status, 400);
});

// Fix 2: Body size limit - oversized body should return 413

Deno.test("oversized body returns 413", async () => {
    const oversizeLength = 1024 * 1024 + 1;
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: '{"payload": "test"}',
        headers: { ...authHeaders, "content-length": oversizeLength.toString() },
    });
    const response = await handler(request);
    assertEquals(response.status, 413);
});

// Fix 3: HTTP method enforcement - POST to dequeue should return 405

Deno.test("POST to dequeue returns 405", async () => {
    const request = new Request("http://localhost:3000/dequeue/testqueue", {
        method: "POST",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 405);
});

// Fix 3: HTTP method enforcement - POST to length should return 405

Deno.test("POST to length returns 405", async () => {
    const request = new Request("http://localhost:3000/length/testqueue", {
        method: "POST",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 405);
});

// /queues endpoint: GET returns list of queue names

Deno.test("GET /queues returns empty array when no queues", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body, []);
});

Deno.test("GET /queues returns queue names", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    mgr.enqueue("queue1", "item1");
    mgr.enqueue("queue2", "item2");
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.sort(), ["queue1", "queue2"]);
});

Deno.test("POST /queues returns 405", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "POST",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 405);
});

Deno.test("GET /queues requires bearer token", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "GET",
    });
    const response = await handler(request);
    assertEquals(response.status, 401);
});

Deno.test("GET /queues returns sorted queue names", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    mgr.enqueue("zebra", "item1");
    mgr.enqueue("alpha", "item2");
    mgr.enqueue("mango", "item3");
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.sort(), ["alpha", "mango", "zebra"]);
});

Deno.test("GET /queues does not include cleaned-up empty queues", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    mgr.enqueue("persistent", "item1");
    mgr.enqueue("transient", "item2");
    mgr.dequeue("transient"); // queue becomes empty and gets cleaned up
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body, ["persistent"]);
});

// Peek endpoint: POST returns 405

Deno.test("POST to peek returns 405", async () => {
    const request = new Request("http://localhost:3000/peek/testqueue", {
        method: "POST",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 405);
});

// Health endpoint: returns 200 without authentication

Deno.test("health endpoint returns 200 without auth", async () => {
    const request = new Request("http://localhost:3000/health", {
        method: "GET",
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
});

// Health endpoint: returns JSON body with status ok

Deno.test("health endpoint returns JSON status ok", async () => {
    const request = new Request("http://localhost:3000/health", {
        method: "GET",
    });
    const response = await handler(request);
    const body = await response.json();
    assertEquals(body, { status: "ok" });
});

// Health endpoint: POST returns 405

Deno.test("health endpoint returns 405 on POST", async () => {
    const request = new Request("http://localhost:3000/health", {
        method: "POST",
    });
    const response = await handler(request);
    assertEquals(response.status, 405);
});

// Fix 4: Queue name validation - long queue name should return 400

Deno.test("long queue name returns 400 on enqueue", async () => {
    const longName = "a".repeat(129);
    const request = new Request(`http://localhost:3000/enqueue/${longName}`, {
        method: "POST",
        body: '{"payload": "test"}',
        headers: { ...authHeaders, "content-length": "18" },
    });
    const response = await handler(request);
    assertEquals(response.status, 400);
});

// Fix 4: Queue name validation - long queue name on dequeue

Deno.test("long queue name returns 400 on dequeue", async () => {
    const longName = "a".repeat(129);
    const request = new Request(`http://localhost:3000/dequeue/${longName}`, {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 400);
});

// Fix 4: Queue name validation - long queue name on length

Deno.test("long queue name returns 400 on length", async () => {
    const longName = "a".repeat(129);
    const request = new Request(`http://localhost:3000/length/${longName}`, {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 400);
});

// Fix 4: Queue name validation - long queue name on peek

Deno.test("long queue name returns 400 on peek", async () => {
    const longName = "a".repeat(129);
    const request = new Request(`http://localhost:3000/peek/${longName}`, {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 400);
});

// Happy path: valid enqueue should succeed

Deno.test("valid enqueue succeeds", async () => {
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: '{"payload": "test"}',
        headers: { ...authHeaders, "content-length": "18" },
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
});

// Happy path: GET dequeue should succeed

Deno.test("GET dequeue succeeds", async () => {
    const request = new Request("http://localhost:3000/dequeue/testqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
});

// Happy path: GET length should succeed

Deno.test("GET length succeeds", async () => {
    const request = new Request("http://localhost:3000/length/testqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
});

// Happy path: GET peek returns 200 with payload when queue has items

Deno.test("GET peek returns 200 with payload when queue has items", async () => {
    // First enqueue something to peek at
    const enqueueReq = new Request("http://localhost:3000/enqueue/peektest", {
        method: "POST",
        body: JSON.stringify({ payload: "peekable" }),
        headers: { ...authHeaders, "content-length": "28" },
    });
    await handler(enqueueReq);

    const request = new Request("http://localhost:3000/peek/peektest", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/json");
    assertEquals(await response.json(), "peekable");
});

// Happy path: GET peek returns 204 when queue is empty

Deno.test("GET peek returns 204 when queue is empty", async () => {
    const request = new Request("http://localhost:3000/peek/emptyqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 204);
});

Deno.test("dequeue returns application/json for object payload", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);

    const enqueueReq = new Request("http://localhost:3000/enqueue/jsonqueue", {
        method: "POST",
        body: JSON.stringify({ payload: { foo: "bar" } }),
        headers: authHeaders,
    });
    await handler(enqueueReq);

    const request = new Request("http://localhost:3000/dequeue/jsonqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/json");
    const body = await response.json();
    assertEquals(body, { foo: "bar" });
});

Deno.test("dequeue returns application/json for array payload", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);

    const enqueueReq = new Request("http://localhost:3000/enqueue/jsonqueue", {
        method: "POST",
        body: JSON.stringify({ payload: [1, 2, 3] }),
        headers: authHeaders,
    });
    await handler(enqueueReq);

    const request = new Request("http://localhost:3000/dequeue/jsonqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/json");
    const body = await response.json();
    assertEquals(body, [1, 2, 3]);
});

Deno.test("dequeue returns application/json for number payload", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);

    const enqueueReq = new Request("http://localhost:3000/enqueue/jsonqueue", {
        method: "POST",
        body: JSON.stringify({ payload: 42 }),
        headers: authHeaders,
    });
    await handler(enqueueReq);

    const request = new Request("http://localhost:3000/dequeue/jsonqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/json");
    assertEquals(await response.json(), 42);
});

Deno.test("dequeue returns application/json for boolean payload", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);

    const enqueueReq = new Request("http://localhost:3000/enqueue/jsonqueue", {
        method: "POST",
        body: JSON.stringify({ payload: true }),
        headers: authHeaders,
    });
    await handler(enqueueReq);

    const request = new Request("http://localhost:3000/dequeue/jsonqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/json");
    assertEquals(await response.json(), true);
});

// queue-nyc: Missing payload key returns 400

Deno.test("missing payload key returns 400", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: '{"data": "foo"}',
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 400);
});

// queue-w37: Null payload is rejected with 400

Deno.test("null payload returns 400", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: '{"payload": null}',
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 400);
});

// queue-nyc: Valid payload returns 200

Deno.test("valid payload key returns 200", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: '{"payload": "test"}',
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
});

// queue-o3b: Health check works even when rate limit is exhausted

Deno.test("health check exempt from rate limiting", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN, 1); // 1 request per minute

    // Exhaust rate limit with a non-health request
    const apiReq = new Request("http://localhost:3000/queues", {
        method: "GET",
        headers: authHeaders,
    });
    await handler(apiReq);

    // Rate limit is now exhausted for this IP — health check should still work
    const healthReq = new Request("http://localhost:3000/health", {
        method: "GET",
    });
    const response = await handler(healthReq);
    assertEquals(response.status, 200);
});

// queue-zla: Body within limit is accepted

Deno.test("body within limit is accepted", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: '{"payload": "small body"}',
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
});

// queue-zla: Body exceeding limit is rejected without Content-Length header

Deno.test("body exceeding limit rejected without Content-Length", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const bigBody = '{"payload": "' + "x".repeat(1024 * 1024) + '"}';
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: bigBody,
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 413);
});

// queue-zla: Body exceeding limit rejected with fake Content-Length

Deno.test("body exceeding limit rejected with fake Content-Length", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const bigBody = '{"payload": "' + "x".repeat(1024 * 1024) + '"}';
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: bigBody,
        headers: { ...authHeaders, "content-length": "10" }, // lied
    });
    const response = await handler(request);
    assertEquals(response.status, 413);
});

// queue-utf8: a chunked multi-byte UTF-8 body whose byte size exceeds the
// limit but whose UTF-16 code-unit count is under it must still be rejected.
// The byte limit must be measured in bytes, not in JS string code units.

Deno.test("oversized multi-byte UTF-8 body without content-length returns 413", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    // U+4E00 is one UTF-16 code unit but three UTF-8 bytes.
    // 400000 chars -> ~1.2 MiB of wire bytes, < 1 MiB of code units.
    const fill = "一".repeat(400000);
    const bodyBytes = new TextEncoder().encode(JSON.stringify({ payload: fill }));
    assertEquals(bodyBytes.length > 1024 * 1024, true); // exceeds byte limit
    const bodyStream = new ReadableStream({
        start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
        },
    });
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: bodyStream,
        headers: authHeaders, // no content-length -> chunked
        // @ts-ignore: duplex is required for streaming bodies in Deno
        duplex: "half",
    });
    const response = await handler(request);
    assertEquals(response.status, 413);
});

// queue-02t: Body read error returns 413 not 400

Deno.test("body read error returns 413 not 400", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);
    const bodyStream = new ReadableStream({
        start(controller) {
            controller.error(new Error("stream error"));
        },
    });
    const request = new Request("http://localhost:3000/enqueue/testqueue", {
        method: "POST",
        body: bodyStream,
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 413);
});

Deno.test("dequeue returns application/json for string payload", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);

    const enqueueReq = new Request("http://localhost:3000/enqueue/jsonqueue", {
        method: "POST",
        body: JSON.stringify({ payload: "hello world" }),
        headers: authHeaders,
    });
    await handler(enqueueReq);

    const request = new Request("http://localhost:3000/dequeue/jsonqueue", {
        method: "GET",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/json");
    assertEquals(await response.json(), "hello world");
});

Deno.test("Manager: enqueue followed by multiple dequeues (catches state corruption)", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    mgr.enqueue("q", "1");
    mgr.enqueue("q", "2");
    mgr.enqueue("q", "3");
    assertEquals(mgr.dequeue("q"), "1");
    assertEquals(mgr.length("q"), 2);
    assertEquals(mgr.dequeue("q"), "2");
    assertEquals(mgr.length("q"), 1);
    assertEquals(mgr.dequeue("q"), "3");
    assertEquals(mgr.length("q"), 0);
    assertEquals(mgr.dequeue("q"), undefined);
    assertEquals(mgr.length("q"), 0);
});

// ==============================================================================
// API BEHAVIOR TESTS - Test public HTTP interface
// ==============================================================================

const TEST_TOKEN = "test-token-12345";

function makeTestHandler() {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    return createHandler(mgr, TEST_TOKEN);
}

Deno.test("API: enqueue with valid token returns 200 (catches auth mutation)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/enqueue/test", {
            method: "POST",
            body: JSON.stringify({ payload: "data" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    assertEquals(res.status, 200);
});

Deno.test("API: dequeue with valid token returns 200 (catches auth)", async () => {
    const handler = makeTestHandler();
    await handler(
        new Request("http://localhost/enqueue/q", {
            method: "POST",
            body: JSON.stringify({ payload: "item" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/q", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 200);
});

Deno.test("API: length with valid token returns 200 (catches auth)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/length/q", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 200);
});

Deno.test("API: enqueue without token returns 401 (catches auth bypass)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/enqueue/test", {
            method: "POST",
            body: JSON.stringify({ payload: "data" }),
            headers: { "Content-Type": "application/json" },
        })
    );
    assertEquals(res.status, 401);
});

Deno.test("API: dequeue without token returns 401 (catches auth bypass)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/dequeue/test", {
            headers: { "Authorization": `Bearer wrong-token` },
        })
    );
    assertEquals(res.status, 401);
});

Deno.test("API: length without token returns 401 (catches auth bypass)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/length/test")
    );
    assertEquals(res.status, 401);
});

Deno.test("API: enqueue stores payload and dequeue retrieves it (catches data loss)", async () => {
    const handler = makeTestHandler();
    const payload = "my-important-data";
    const enqRes = await handler(
        new Request("http://localhost/enqueue/data-queue", {
            method: "POST",
            body: JSON.stringify({ payload }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    assertEquals(enqRes.status, 200);
    const deqRes = await handler(
        new Request("http://localhost/dequeue/data-queue", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(deqRes.status, 200);
    assertEquals(await deqRes.json(), payload);
});

Deno.test("API: dequeue empty queue returns 204 (catches crash)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/dequeue/empty-queue", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 204);
    // Mutation check: if dequeue crashes or returns wrong value
});

Deno.test("API: length returns numeric string (catches type mutation)", async () => {
    const handler = makeTestHandler();
    await handler(
        new Request("http://localhost/enqueue/count-q", {
            method: "POST",
            body: JSON.stringify({ payload: "1" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    await handler(
        new Request("http://localhost/enqueue/count-q", {
            method: "POST",
            body: JSON.stringify({ payload: "2" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    const res = await handler(
        new Request("http://localhost/length/count-q", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 200);
    const text = await res.text();
    assertEquals(text, "2");
});

Deno.test("API: unknown endpoint returns 404 (catches routing mutation)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/unknown/path", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 404);
});

Deno.test("API: GET request to enqueue is rejected (catches method check)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/enqueue/q", {
            method: "GET",
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 405);
});

Deno.test("API: POST request to dequeue is rejected (catches method check)", async () => {
    const handler = makeTestHandler();
    await handler(
        new Request("http://localhost/enqueue/q", {
            method: "POST",
            body: JSON.stringify({ payload: "item" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/q", {
            method: "POST",
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 405);
});

Deno.test("API: queue name with special characters (catches injection)", async () => {
    const handler = makeTestHandler();
    const queueName = "queue-with-dashes_and_underscores";
    const res = await handler(
        new Request(`http://localhost/enqueue/${queueName}`, {
            method: "POST",
            body: JSON.stringify({ payload: "data" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    assertEquals(res.status, 200);
});

Deno.test("API: FIFO order through HTTP (catches dequeue order mutation)", async () => {
    const handler = makeTestHandler();
    const queueName = "order-test-queue";
    for (const item of ["first", "second", "third"]) {
        await handler(
            new Request(`http://localhost/enqueue/${queueName}`, {
                method: "POST",
                body: JSON.stringify({ payload: item }),
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${TEST_TOKEN}`,
                },
            })
        );
    }
    for (const expected of ["first", "second", "third"]) {
        const res = await handler(
            new Request(`http://localhost/dequeue/${queueName}`, {
                headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
            })
        );
        assertEquals(await res.json(), expected);
    }
});

Deno.test("API: multiple queues isolated (catches queue mixing)", async () => {
    const handler = makeTestHandler();
    const enqueue = async (queue: string, payload: string) => {
        await handler(
            new Request(`http://localhost/enqueue/${queue}`, {
                method: "POST",
                body: JSON.stringify({ payload }),
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${TEST_TOKEN}`,
                },
            })
        );
    };
    await enqueue("q1", "q1-item");
    await enqueue("q2", "q2-item");
    const res1 = await handler(
        new Request("http://localhost/dequeue/q1", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(await res1.json(), "q1-item");
    const res2 = await handler(
        new Request("http://localhost/dequeue/q2", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(await res2.json(), "q2-item");
});

Deno.test("API: enqueue with empty payload (catches validation)", async () => {
    const handler = makeTestHandler();
    const res = await handler(
        new Request("http://localhost/enqueue/q", {
            method: "POST",
            body: JSON.stringify({ payload: "" }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    assertEquals(res.status, 200);
    const lenRes = await handler(
        new Request("http://localhost/length/q", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const len = await lenRes.text();
    assertEquals(len, "1");
});

Deno.test("API: very long payload (catches buffer handling)", async () => {
    const handler = makeTestHandler();
    const longPayload = "x".repeat(10000);
    const res = await handler(
        new Request("http://localhost/enqueue/big-q", {
            method: "POST",
            body: JSON.stringify({ payload: longPayload }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TEST_TOKEN}`,
            },
        })
    );
    assertEquals(res.status, 200);
    const deqRes = await handler(
        new Request("http://localhost/dequeue/big-q", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(await deqRes.json(), longPayload);
});

Deno.test("auth: no token on enqueue returns 401", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: { "Content-Type": "application/json" },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: no token on dequeue returns 401", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/dequeue/foo");
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: no token on length returns 401", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/length/foo");
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: wrong token on enqueue returns 401", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer wrong-token",
        },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: wrong token on dequeue returns 401", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/dequeue/foo", {
        headers: { "Authorization": "Bearer wrong-token" },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: wrong token on length returns 401", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/length/foo", {
        headers: { "Authorization": "Bearer wrong-token" },
    });
    const res = await handler(req);
    assertEquals(401, res.status);
});

Deno.test("auth: valid token on enqueue returns 200", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TEST_TOKEN}`,
        },
    });
    const res = await handler(req);
    assertEquals(200, res.status);
});

Deno.test("auth: valid token on dequeue returns 200", async () => {
    const handler = makeTestHandler();
    const enqReq = new Request("http://localhost/enqueue/foo", {
        method: "POST",
        body: JSON.stringify({ payload: "bar" }),
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TEST_TOKEN}`,
        },
    });
    await handler(enqReq);

    const deqReq = new Request("http://localhost/dequeue/foo", {
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
    });
    const res = await handler(deqReq);
    assertEquals(200, res.status);
});

Deno.test("auth: valid token on length returns 200", async () => {
    const handler = makeTestHandler();
    const req = new Request("http://localhost/length/foo", {
        headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
    });
    const res = await handler(req);
    assertEquals(200, res.status);
});

Deno.test("dequeue distinguishes string zero from number zero", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);

    await handler(new Request("http://localhost:3000/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: "0" }),
        headers: authHeaders,
    }));
    await handler(new Request("http://localhost:3000/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: 0 }),
        headers: authHeaders,
    }));

    const first = await handler(new Request("http://localhost:3000/dequeue/q", {
        headers: authHeaders,
    }));
    assertEquals(first.status, 200);
    assertEquals(first.headers.get("content-type"), "application/json");
    assertEquals(await first.json(), "0");

    const second = await handler(new Request("http://localhost:3000/dequeue/q", {
        headers: authHeaders,
    }));
    assertEquals(second.status, 200);
    assertEquals(second.headers.get("content-type"), "application/json");
    assertEquals(await second.json(), 0);
});

Deno.test("peek returns JSON for a string payload", async () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const handler = createHandler(mgr, API_TOKEN);

    await handler(new Request("http://localhost:3000/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: "hello" }),
        headers: authHeaders,
    }));

    const response = await handler(new Request("http://localhost:3000/peek/q", {
        headers: authHeaders,
    }));
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "application/json");
    assertEquals(await response.json(), "hello");
});
