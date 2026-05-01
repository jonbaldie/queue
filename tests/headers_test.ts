import { assertEquals } from "jsr:@std/assert@1.0";
import * as Persistency from "../src/persist.ts";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";

const TEST_TOKEN = "test-token-headers";

function makeHandler() {
    const mgr = new QueueManager(new Persistency.None);
    return createHandler(mgr, TEST_TOKEN);
}

// ============================================================
// Cache-Control: no-store on all responses
// ============================================================
Deno.test("headers: health includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/health", { method: "GET" }));
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: 404 includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/unknown", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 404);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: 401 includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/enqueue/foo"));
    assertEquals(res.status, 401);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: 405 includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/dequeue/foo", { method: "POST", headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 405);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: 429 includes Cache-Control: no-store", async () => {
    const mgr = new QueueManager(new Persistency.None);
    const handler = createHandler(mgr, TEST_TOKEN, 0);
    const res = await handler(
        new Request("http://localhost/health", { method: "GET" })
    );
    assertEquals(res.status, 429);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

// ============================================================
// /health Content-Type
// ============================================================
Deno.test("headers: health has Content-Type: application/json", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://localhost/health", { method: "GET" }));
    assertEquals(res.headers.get("Content-Type"), "application/json");
});

// ============================================================
// /length Content-Type
// ============================================================
Deno.test("headers: length returns Content-Type: text/plain", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/length/foo", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

// ============================================================
// /dequeue Content-Type — string payloads
// ============================================================
Deno.test("headers: dequeue string payload returns Content-Type: text/plain", async () => {
    const handler = makeHandler();
    await handler(
        new Request("http://localhost/enqueue/foo", {
            method: "POST",
            body: JSON.stringify({ payload: "hello" }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/foo", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
    assertEquals(await res.text(), "hello");
});

// ============================================================
// /dequeue Content-Type — JSON object payloads
// ============================================================
Deno.test("headers: dequeue JSON object payload returns Content-Type: application/json", async () => {
    const handler = makeHandler();
    const payload = JSON.stringify({ id: 1, name: "alice" });
    await handler(
        new Request("http://localhost/enqueue/objq", {
            method: "POST",
            body: JSON.stringify({ payload }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/objq", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(await res.json(), { id: 1, name: "alice" });
});

// ============================================================
// /dequeue Content-Type — JSON array payloads
// ============================================================
Deno.test("headers: dequeue JSON array payload returns Content-Type: application/json", async () => {
    const handler = makeHandler();
    const payload = JSON.stringify(["a", "b", "c"]);
    await handler(
        new Request("http://localhost/enqueue/arrq", {
            method: "POST",
            body: JSON.stringify({ payload }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/arrq", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(await res.json(), ["a", "b", "c"]);
});

// ============================================================
// /dequeue Content-Type — scalar JSON values (null, number, boolean, string)
// ============================================================
Deno.test("headers: dequeue scalar number payload returns text/plain", async () => {
    const handler = makeHandler();
    const payload = JSON.stringify(42);
    await handler(
        new Request("http://localhost/enqueue/numq", {
            method: "POST",
            body: JSON.stringify({ payload }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/numq", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

Deno.test("headers: dequeue null payload returns text/plain", async () => {
    const handler = makeHandler();
    const payload = JSON.stringify(null);
    await handler(
        new Request("http://localhost/enqueue/nullq", {
            method: "POST",
            body: JSON.stringify({ payload }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/nullq", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

// ============================================================
// /queues Content-Type
// ============================================================
Deno.test("headers: queues returns Content-Type: application/json", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/queues", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
});

// ============================================================
// /enqueue Content-Type
// ============================================================
Deno.test("headers: enqueue success returns Content-Type: text/plain", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/enqueue/foo", {
            method: "POST",
            body: JSON.stringify({ payload: "hi" }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
});

// ============================================================
// /peek Content-Type
// ============================================================
Deno.test("headers: peek string payload returns Content-Type: text/plain", async () => {
    const handler = makeHandler();
    await handler(
        new Request("http://localhost/enqueue/peekq", {
            method: "POST",
            body: JSON.stringify({ payload: "peekable" }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/peek/peekq", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "text/plain");
    assertEquals(await res.text(), "peekable");
});

Deno.test("headers: peek JSON object payload returns Content-Type: application/json", async () => {
    const handler = makeHandler();
    const payload = JSON.stringify({ key: "val" });
    await handler(
        new Request("http://localhost/enqueue/peekobj", {
            method: "POST",
            body: JSON.stringify({ payload }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/peek/peekobj", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    assertEquals(await res.json(), { key: "val" });
});

// ============================================================
// Cache-Control on successful endpoints
// ============================================================
Deno.test("headers: enqueue success includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/enqueue/foo", {
            method: "POST",
            body: JSON.stringify({ payload: "bar" }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: dequeue success includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    await handler(
        new Request("http://localhost/enqueue/dq", {
            method: "POST",
            body: JSON.stringify({ payload: "x" }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/dequeue/dq", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: queues success includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/queues", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: peek success includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    await handler(
        new Request("http://localhost/enqueue/pk", {
            method: "POST",
            body: JSON.stringify({ payload: "y" }),
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    const res = await handler(
        new Request("http://localhost/peek/pk", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: length success includes Cache-Control: no-store", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/length/foo", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: dequeue empty returns Cache-Control: no-store on 204", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/dequeue/empty", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 204);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});

Deno.test("headers: peek empty returns Cache-Control: no-store on 204", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/peek/empty", { headers: { "Authorization": `Bearer ${TEST_TOKEN}` } })
    );
    assertEquals(res.status, 204);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
});
