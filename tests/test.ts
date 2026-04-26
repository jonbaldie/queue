import { assertEquals } from "jsr:@std/assert";
import * as Persistency from "../src/persist.ts";
import Queue from "../src/queue.ts";
import QueueManager from "../src/manager.ts";

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

Deno.test("manager enqueue", async () => {
    const mgr = new QueueManager(new Persistency.None);

    await mgr.enqueue("queue", "foo");
    await mgr.enqueue("queue", "bar");

    assertEquals("foo", await mgr.dequeue("queue"));
    assertEquals("bar", await mgr.dequeue("queue"));
});

Deno.test("manager length", async () => {
    const mgr = new QueueManager(new Persistency.None);

    await mgr.enqueue("queue", "foo");

    assertEquals(1, await mgr.length("queue"));

    await mgr.enqueue("queue", "bar");

    assertEquals(2, await mgr.length("queue"));

    await mgr.dequeue("queue");

    assertEquals(1, await mgr.length("queue"));

    await mgr.dequeue("queue");

    assertEquals(0, await mgr.length("queue"));
});

Deno.test("manager persistency", async () => {
    const persist = new Persistency.File;
    const mgr = new QueueManager(persist);

    persist.clear();
    persist.append(`{ "queue": "foo", "payload": "bar", "enqueue": true, "dequeue": false }`);
    persist.append(`{ "queue": "fee", "payload": "bat", "enqueue": true, "dequeue": false }`);
    persist.append(`{ "queue": "fee", "payload": "gat", "enqueue": true, "dequeue": false }`);
    persist.append(`{ "queue": "fee", "payload": "bat", "enqueue": false, "dequeue": true }`);

    mgr.load();

    assertEquals("", persist.load());
    assertEquals(1, await mgr.length("foo"));
    assertEquals("bar", await mgr.dequeue("foo"));
    assertEquals(1, await mgr.length("fee"));
    assertEquals("gat", await mgr.dequeue("fee"));
});

Deno.test("json persistency", async () => {
    const persist = new Persistency.File;
    const mgr = new QueueManager(persist);
    const payload = "php /var/www/html/index.php";

    persist.clear();
    persist.append(JSON.stringify({ queue: "foo", payload: payload, enqueue: true, dequeue: false }));

    mgr.load();

    assertEquals("", persist.load());
    assertEquals(1, await mgr.length("foo"));
    assertEquals(payload, await mgr.dequeue("foo"));
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
    assertEquals(5, await mgr.length("q1"));

    // Read back all items
    const items = [];
    for (let i = 0; i < 5; i++) {
        const item = await mgr.dequeue("q1");
        if (item) items.push(item);
    }

    assertEquals(5, items.length);
    assertEquals(0, await mgr.length("q1"));

    persist.clear();
});

Deno.test("persist operations handle I/O errors gracefully", async () => {
    const persist = new Persistency.File;
    // Set an invalid directory to trigger an I/O error
    persist.dir("/nonexistent/invalid/path");

    let errorThrown = false;
    try {
        persist.append(`{ "queue": "foo", "payload": "bar", "enqueue": true, "dequeue": false }`);
    } catch (e) {
        errorThrown = true;
    }

    assertEquals(true, errorThrown);
});
