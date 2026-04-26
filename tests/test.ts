import { assertEquals } from "jsr:@std/assert";
import * as Persistency from "../src/persist.ts";
import Queue from "../src/queue.ts";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";

const API_TOKEN = "test-token";
const mgr = new QueueManager(new Persistency.None);
const handler = createHandler(mgr, API_TOKEN);
const authHeaders = { "Authorization": `Bearer ${API_TOKEN}` };

// Fix 1: JSON parse safety - malformed JSON should return 400
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

Deno.test("queue enqueue and dequeue", () => {
    const queue = new Queue([]);
    
    queue.enqueue("foo");
    queue.enqueue("bar");

    assertEquals("foo", queue.dequeue());
    assertEquals("bar", queue.dequeue());
});

Deno.test("queue length", () => {
    const queue = new Queue([]);

    queue.enqueue("foo");

    assertEquals(1, queue.length());

    queue.enqueue("bar");

    assertEquals(2, queue.length());

    queue.dequeue();

    assertEquals(1, queue.length());

    queue.dequeue();

    assertEquals(0, queue.length());
});

Deno.test("queue empty", () => {
    const queue = new Queue([]);

    assertEquals(true, queue.is_empty());

    queue.enqueue("foo");

    assertEquals(false, queue.is_empty());

    queue.dequeue();

    assertEquals(true, queue.is_empty());
});

Deno.test("manager enqueue", () => {
    const mgr = new QueueManager(new Persistency.None);

    mgr.enqueue("queue", "foo");
    mgr.enqueue("queue", "bar");

    assertEquals("foo", mgr.dequeue("queue"));
    assertEquals("bar", mgr.dequeue("queue"));
});

Deno.test("manager length", () => {
    const mgr = new QueueManager(new Persistency.None);

    mgr.enqueue("queue", "foo");

    assertEquals(1, mgr.length("queue"));

    mgr.enqueue("queue", "bar");

    assertEquals(2, mgr.length("queue"));

    mgr.dequeue("queue");

    assertEquals(1, mgr.length("queue"));

    mgr.dequeue("queue");

    assertEquals(0, mgr.length("queue"));
});

Deno.test("manager persistency", () => {
    const persist = new Persistency.File;
    const mgr = new QueueManager(persist);

    persist.clear();
    persist.append(`{ "queue": "foo", "payload": "bar", "enqueue": true, "dequeue": false }`);
    persist.append(`{ "queue": "fee", "payload": "bat", "enqueue": true, "dequeue": false }`);
    persist.append(`{ "queue": "fee", "payload": "gat", "enqueue": true, "dequeue": false }`);
    persist.append(`{ "queue": "fee", "payload": "bat", "enqueue": false, "dequeue": true }`);

    mgr.load();

    assertEquals("", persist.load());
    assertEquals(1, mgr.length("foo"));
    assertEquals("bar", mgr.dequeue("foo"));
    assertEquals(1, mgr.length("fee"));
    assertEquals("gat", mgr.dequeue("fee"));
});

Deno.test("json persistency", () => {
    const persist = new Persistency.File;
    const mgr = new QueueManager(persist);
    const payload = "php /var/www/html/index.php";

    persist.clear();
    persist.append(JSON.stringify({ queue: "foo", payload: payload, enqueue: true, dequeue: false }));

    mgr.load();

    assertEquals("", persist.load());
    assertEquals(1, mgr.length("foo"));
    assertEquals(payload, mgr.dequeue("foo"));
});

Deno.test("persistency", () => {
    const persist = new Persistency.File;

    persist.clear();

    const load = (): string => new TextDecoder().decode(Deno.readFileSync("persist.dat"));

    assertEquals("", load());

    persist.append(`{ "queue": "foo", "payload": "bar", "enqueue": true, "dequeue": false }`);

    assertEquals(`{ "queue": "foo", "payload": "bar", "enqueue": true, "dequeue": false }` + "\n", load());
    assertEquals(load(), persist.load());

    persist.clear();

    assertEquals("", load());
});

Deno.test("queue peek returns value not index", () => {
    const queue = new Queue([]);

    queue.enqueue("first_message");

    const peeked = queue.peek();
    assertEquals("first_message", peeked);
});

Deno.test("manager dequeue from empty queue returns undefined", () => {
    const mgr = new QueueManager(new Persistency.None);

    const result = mgr.dequeue("nonexistent");

    assertEquals(undefined, result);
});
