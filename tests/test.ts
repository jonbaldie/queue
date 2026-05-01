import { assertEquals } from "jsr:@std/assert@1.0";
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

// /queues endpoint: GET returns list of queue names
Deno.test("GET /queues returns empty array when no queues", async () => {
    const mgr = new QueueManager(new Persistency.None);
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
    const mgr = new QueueManager(new Persistency.None);
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
    const mgr = new QueueManager(new Persistency.None);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "POST",
        headers: authHeaders,
    });
    const response = await handler(request);
    assertEquals(response.status, 405);
});

Deno.test("GET /queues requires bearer token", async () => {
    const mgr = new QueueManager(new Persistency.None);
    const handler = createHandler(mgr, API_TOKEN);
    const request = new Request("http://localhost:3000/queues", {
        method: "GET",
    });
    const response = await handler(request);
    assertEquals(response.status, 401);
});

Deno.test("GET /queues returns sorted queue names", async () => {
    const mgr = new QueueManager(new Persistency.None);
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
    const mgr = new QueueManager(new Persistency.None);
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
    const body = await response.text();
    assertEquals(body, "peekable");
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

Deno.test("concurrent enqueue writes to file", async () => {
    const persist = new Persistency.File;
    persist.clear();

    const mgr = new QueueManager(persist);

    // Fire 10 concurrent enqueue operations
    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(
            mgr.enqueue("test_queue", `item_${i}`)
        );
    }

    await Promise.all(promises);

    // Read the file and verify all items were persisted
    const content = persist.load();
    const lines = content.split("\n").filter((line: string) => line.length);

    // Should have exactly 10 enqueue operations
    assertEquals(10, lines.length);

    // All lines should be valid JSON with enqueue=true
    lines.forEach((line: string) => {
        const obj = JSON.parse(line);
        assertEquals(true, obj.enqueue);
        assertEquals("test_queue", obj.queue);
    });

    persist.clear();
});

Deno.test("concurrent manager operations maintain data integrity", async () => {
    const persist = new Persistency.File;
    persist.clear();

    const mgr = new QueueManager(persist);

    // Fire multiple concurrent enqueue operations
    const promises = [];
    for (let i = 0; i < 5; i++) {
        promises.push(
            mgr.enqueue("q1", `item_${i}`)
        );
    }

    await Promise.all(promises);

    // All items should be in the queue
    assertEquals(5, mgr.length("q1"));

    // Read back all items
    const items = [];
    for (let i = 0; i < 5; i++) {
        const item = mgr.dequeue("q1");
        if (item) items.push(item);
    }

    assertEquals(5, items.length);
    assertEquals(0, mgr.length("q1"));

    persist.clear();
});

Deno.test("persist operations handle I/O errors gracefully", () => {
    const persist = new Persistency.File;
    // Set an invalid directory to trigger an I/O error
    persist.dir("/nonexistent/invalid/path");

    let errorThrown = false;
    try {
        persist.append(`{ "queue": "foo", "payload": "bar", "enqueue": true, "dequeue": false }`);
    } catch (_e) {
        errorThrown = true;
    }

    assertEquals(true, errorThrown);
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

Deno.test("manager cleans up empty queues to prevent unbounded growth", () => {
    const mgr = new QueueManager(new Persistency.None, 10000, 1);

    mgr.enqueue("transient", "foo");
    assertEquals(false, mgr.canCreateQueue()); // At limit

    mgr.dequeue("transient");
    assertEquals(true, mgr.canCreateQueue()); // Freed up by cleanup

    mgr.enqueue("another", "bar");
    assertEquals("bar", mgr.dequeue("another"));
});

Deno.test("dequeue from empty unknown queue does not remove auto-created queue", () => {
    const mgr = new QueueManager(new Persistency.None, 10000, 1);

    // Auto-creates an empty queue; was never non-empty so stays registered
    mgr.dequeue("never-existed");
    assertEquals(false, mgr.canCreateQueue());
});

Deno.test("enqueue after cleanup restores queue", () => {
    const mgr = new QueueManager(new Persistency.None);

    mgr.enqueue("queue", "foo");
    mgr.dequeue("queue"); // cleanup

    mgr.enqueue("queue", "bar");
    assertEquals(1, mgr.length("queue"));
    assertEquals("bar", mgr.dequeue("queue"));
});

Deno.test("queue is removed only after last item is dequeued", () => {
    const mgr = new QueueManager(new Persistency.None, 10000, 1);

    mgr.enqueue("queue", "a");
    mgr.enqueue("queue", "b");

    // Still has one item, should still exist
    mgr.dequeue("queue");
    mgr.enqueue("queue", "c"); // must succeed on existing queue
    assertEquals(2, mgr.length("queue"));

    // Now empty it out completely
    mgr.dequeue("queue");
    mgr.dequeue("queue");
    assertEquals(true, mgr.canCreateQueue()); // freed by cleanup
});

Deno.test("manager load cleans up empty queues from persistence", () => {
    const persist = new Persistency.File;
    persist.clear();

    persist.append(JSON.stringify({ queue: "tmp", payload: "data", enqueue: true, dequeue: false }));
    persist.append(JSON.stringify({ queue: "tmp", payload: "data", enqueue: false, dequeue: true }));

    const mgr = new QueueManager(persist, 10000, 1);
    mgr.load();

    // After load, "tmp" was enqueued then dequeued -> empty -> removed
    assertEquals(true, mgr.canCreateQueue());

    mgr.enqueue("other", "value");
    assertEquals("value", mgr.dequeue("other"));
});
