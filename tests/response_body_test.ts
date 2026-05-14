import { assertEquals } from "jsr:@std/assert@1.0";
import * as Persistency from "../src/persist.ts";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";

const TOKEN = "test-token";

function handler(queueDepth?: number, queueCount?: number, rateLimit?: number) {
    const mgr = new QueueManager(new Persistency.None, queueDepth, queueCount);
    return createHandler(mgr, TOKEN, rateLimit);
}

const auth = { "Authorization": `Bearer ${TOKEN}` };

// ── response body text ────────────────────────────────────────────────────────

Deno.test("response body: health returns {status:ok} JSON", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/health"));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(await res.json(), { status: "ok" });
});

Deno.test("response body: health POST returns 'Method not allowed'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/health", { method: "POST" }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: unauthorized returns 'Unauthorized'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/enqueue/q", { method: "POST", body: '{"payload":"x"}' }));
    assertEquals(res.status, 401);
    assertEquals(await res.text(), "Unauthorized");
});

Deno.test("response body: rate limited returns 'Too many requests'", async () => {
    const h = handler(undefined, undefined, 1);
    await h(new Request("http://localhost/length/q", { headers: auth }));
    const res = await h(new Request("http://localhost/length/q", { headers: auth }));
    assertEquals(res.status, 429);
    assertEquals(await res.text(), "Too many requests");
});

Deno.test("response body: queues POST returns 'Method not allowed'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/queues", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: queues GET returns application/json", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/queues", { headers: auth }));
    assertEquals(res.headers.get("content-type"), "application/json");
});

Deno.test("response body: enqueue POST-only returns 'Method not allowed'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/enqueue/q", { method: "GET", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: queue name exactly 128 chars is accepted", async () => {
    const h = handler();
    const name = "a".repeat(128);
    const res = await h(new Request(`http://localhost/enqueue/${name}`, {
        method: "POST",
        body: '{"payload":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 200);
});

Deno.test("response body: queue name 129 chars returns 'Queue name too long'", async () => {
    const h = handler();
    const name = "a".repeat(129);
    const res = await h(new Request(`http://localhost/enqueue/${name}`, {
        method: "POST",
        body: '{"payload":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: queue full returns 'Queue full or too many queues'", async () => {
    const h = handler(1, undefined);
    await h(new Request("http://localhost/enqueue/q", { method: "POST", body: '{"payload":"x"}', headers: auth }));
    const res = await h(new Request("http://localhost/enqueue/q", { method: "POST", body: '{"payload":"y"}', headers: auth }));
    assertEquals(res.status, 507);
    assertEquals(await res.text(), "Queue full or too many queues");
});

Deno.test("response body: large content-length returns 'Payload too large'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":"x"}',
        headers: { ...auth, "content-length": String(1024 * 1024 + 1) },
    }));
    assertEquals(res.status, 413);
    assertEquals(await res.text(), "Payload too large");
});

Deno.test("response body: missing payload key returns 'Missing payload key'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"data":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Missing payload key");
});

Deno.test("response body: null payload returns 'Null payload not allowed'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":null}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Null payload not allowed");
});

Deno.test("response body: invalid JSON returns 'Invalid JSON'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{bad}',
        headers: auth,
    }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Invalid JSON");
});

Deno.test("response body: successful enqueue returns queue name in body", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/enqueue/myqueue", {
        method: "POST",
        body: '{"payload":"x"}',
        headers: auth,
    }));
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "Payload successfully queued onto myqueue.");
});

Deno.test("response body: dequeue POST returns 'Method not allowed'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/dequeue/q", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: dequeue long name returns 'Queue name too long'", async () => {
    const h = handler();
    const res = await h(new Request(`http://localhost/dequeue/${"a".repeat(129)}`, { headers: auth }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: dequeue object returns application/json", async () => {
    const h = handler();
    await h(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":{"key":"val"}}',
        headers: auth,
    }));
    const res = await h(new Request("http://localhost/dequeue/q", { headers: auth }));
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(await res.json(), { key: "val" });
});

Deno.test("response body: peek POST returns 'Method not allowed'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/peek/q", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: peek long name returns 'Queue name too long'", async () => {
    const h = handler();
    const res = await h(new Request(`http://localhost/peek/${"a".repeat(129)}`, { headers: auth }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: peek object returns application/json", async () => {
    const h = handler();
    await h(new Request("http://localhost/enqueue/q", {
        method: "POST",
        body: '{"payload":{"key":"val"}}',
        headers: auth,
    }));
    const res = await h(new Request("http://localhost/peek/q", { headers: auth }));
    assertEquals(res.headers.get("content-type"), "application/json");
    assertEquals(await res.json(), { key: "val" });
});

Deno.test("response body: length POST returns 'Method not allowed'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/length/q", { method: "POST", headers: auth }));
    assertEquals(await res.text(), "Method not allowed");
});

Deno.test("response body: length long name returns 'Queue name too long'", async () => {
    const h = handler();
    const res = await h(new Request(`http://localhost/length/${"a".repeat(129)}`, { headers: auth }));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Queue name too long");
});

Deno.test("response body: unknown route returns 'Not found.'", async () => {
    const h = handler();
    const res = await h(new Request("http://localhost/unknown", { headers: auth }));
    assertEquals(res.status, 404);
    assertEquals(await res.text(), "Not found.");
});
