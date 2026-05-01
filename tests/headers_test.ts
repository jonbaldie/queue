import { assertEquals } from "jsr:@std/assert@1.0";
import * as Persistency from "../src/persist.ts";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";

const TEST_TOKEN = "test-secret-token";

function makeHandler() {
    const mgr = new QueueManager(new Persistency.None);
    return createHandler(mgr, TEST_TOKEN);
}

const authHeaders = { "Authorization": `Bearer ${TEST_TOKEN}` };

// =============================================================================
// CONTENT-TYPE HEADERS
// =============================================================================

Deno.test("headers: dequeue string payload returns text/plain", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: "hello" }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    const res = await handler(new Request("http://localhost/dequeue/q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

Deno.test("headers: dequeue JSON object payload returns application/json", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: JSON.stringify({ id: 1 }) }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    const res = await handler(new Request("http://localhost/dequeue/q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
});

Deno.test("headers: dequeue JSON array payload returns application/json", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: JSON.stringify([1, 2, 3]) }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    const res = await handler(new Request("http://localhost/dequeue/q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
});

Deno.test("headers: dequeue null JSON returns text/plain", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: "null" }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    const res = await handler(new Request("http://localhost/dequeue/q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

Deno.test("headers: length returns text/plain", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/length/q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

Deno.test("headers: health returns application/json", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/health"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
});

// =============================================================================
// CACHE-CONTROL HEADERS
// =============================================================================

Deno.test("headers: all 200 responses include Cache-Control: no-store", async () => {
    const handler = makeHandler();

    // enqueue
    const enq = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: "x" }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    assertEquals(enq.headers.get("Cache-Control"), "no-store");

    // dequeue
    const deq = await handler(new Request("http://localhost/dequeue/q", {
        headers: authHeaders,
    }));
    assertEquals(deq.headers.get("Cache-Control"), "no-store");

    // length
    const len = await handler(new Request("http://localhost/length/q", {
        headers: authHeaders,
    }));
    assertEquals(len.headers.get("Cache-Control"), "no-store");

    // health
    const health = await handler(new Request("http://localhost/health"));
    assertEquals(health.headers.get("Cache-Control"), "no-store");

    // queues
    const queues = await handler(new Request("http://localhost/queues", {
        headers: authHeaders,
    }));
    assertEquals(queues.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: 4xx responses include Cache-Control: no-store", async () => {
    const handler = makeHandler();

    // 401 unauthorized
    const unauth = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: "x" }),
    }));
    assertEquals(unauth.status, 401);
    assertEquals(unauth.headers.get("Cache-Control"), "no-store");

    // 405 method not allowed
    const method = await handler(new Request("http://localhost/enqueue/q", {
        method: "GET",
        headers: authHeaders,
    }));
    assertEquals(method.status, 405);
    assertEquals(method.headers.get("Cache-Control"), "no-store");

    // 404 not found
    const notfound = await handler(new Request("http://localhost/unknown", {
        headers: authHeaders,
    }));
    assertEquals(notfound.status, 404);
    assertEquals(notfound.headers.get("Cache-Control"), "no-store");

    // 400 bad request (malformed JSON)
    const badreq = await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: "not-json",
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    assertEquals(badreq.status, 400);
    assertEquals(badreq.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: 204 response includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/dequeue/empty-q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 204);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: peek string payload returns text/plain", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: "hello" }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    const res = await handler(new Request("http://localhost/peek/q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

Deno.test("headers: peek JSON object payload returns application/json", async () => {
    const handler = makeHandler();
    await handler(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: JSON.stringify({ payload: JSON.stringify({ id: 1 }) }),
        headers: { ...authHeaders, "Content-Type": "application/json" },
    }));
    const res = await handler(new Request("http://localhost/peek/q", {
        headers: authHeaders,
    }));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
});
