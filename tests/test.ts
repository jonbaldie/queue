import { assertEquals } from "https://deno.land/std@0.126.0/testing/asserts.ts";
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
