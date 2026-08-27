import { assertEquals, assertNotEquals, assertThrows, assertRejects } from "jsr:@std/assert@1.0";
import QueueManager, { QueueNameTooLongError } from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";
import * as Persistency from "../src/persist.ts";
import { RateLimiter } from "../src/rate_limiter.ts";
import { parseConfig, ConfigError } from "../src/config.ts";

// Shared helpers
const API_TOKEN = "test-token";
const authHeaders = { "Authorization": `Bearer ${API_TOKEN}` };

function makeHandler(token = API_TOKEN, rateLimit = 100) {
    const mgr = new QueueManager(new Persistency.MemoryStore());
    return createHandler(mgr, token, rateLimit);
}


Deno.test("manager save flushes all queues to persist", () => {
    const persist = new Persistency.FileStore;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q1", "a");
    mgr.enqueue("q1", "b");
    mgr.enqueue("q2", "c");

    mgr.save();

    const events = persist.loadState();
    assertEquals(events.length, 3);

    assertEquals(events.every((p: any) => p.enqueue === true), true);
    assertEquals(events.filter((p: any) => p.queue === "q1").length, 2);
    assertEquals(events.filter((p: any) => p.queue === "q2").length, 1);
    persist.close();
});

Deno.test("manager save overwrites previous persist data", () => {
    const persist = new Persistency.FileStore;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q1", "a");
    mgr.save();

    mgr.enqueue("q1", "b");
    mgr.save();

    const events = persist.loadState();
    assertEquals(events.length, 2);
    persist.close();
});

Deno.test("manager save with empty queues writes nothing", () => {
    const persist = new Persistency.FileStore;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.save();

    assertEquals(persist.loadState(), []);
    persist.close();
});

Deno.test("manager save preserves queue order", () => {
    const persist = new Persistency.FileStore;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("q", "first");
    mgr.enqueue("q", "second");
    mgr.enqueue("q", "third");

    mgr.save();

    const events = persist.loadState();
    const payloads = events.map((e: any) => e.payload);
    assertEquals(payloads, ["first", "second", "third"]);
    persist.close();
});

Deno.test("manager save then load round-trips data", () => {
    const persist = new Persistency.FileStore;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("x", "one");
    mgr.enqueue("x", "two");
    mgr.enqueue("y", "three");

    mgr.save();

    const mgr2 = new QueueManager(persist);
    mgr2.load();

    assertEquals(mgr2.length("x"), 2);
    assertEquals(mgr2.length("y"), 1);
    assertEquals(mgr2.dequeue("x"), "one");
    assertEquals(mgr2.dequeue("x"), "two");
    assertEquals(mgr2.dequeue("y"), "three");
    persist.close();
});

async function startServer(env: Record<string, string>): Promise<{ child: Deno.ChildProcess; port: number }> {
    const decoder = new TextDecoder();
    const child = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "main.ts", "--persist"],
        cwd: ".",
        env,
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    const stdoutReader = child.stdout.getReader();
    let port: number | null = null;
    let stdoutBuf = "";

    let timeoutId: number;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Server startup timeout")), 5000);
    });

    const readPromise = (async () => {
        while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;
            stdoutBuf += decoder.decode(value, { stream: true });
            const match = stdoutBuf.match(/Listening on (?:127\.0\.0\.1|localhost):(\d+)/);
            if (match) {
                port = parseInt(match[1], 10);
                break;
            }
        }
        stdoutReader.releaseLock();
    })();

    await Promise.race([readPromise, timeout]);
    clearTimeout(timeoutId!);

    if (port === null) {
        const stderr = await child.stderr.getReader().read();
        const errText = stderr.value ? decoder.decode(stderr.value) : "";
        throw new Error(`Server did not start. stdout: ${stdoutBuf}\nstderr: ${errText}`);
    }

    return { child, port };
}

async function cleanupChild(child: Deno.ChildProcess) {
    try { await child.stdout.cancel(); } catch { /* ignore */ }
    try { await child.stderr.cancel(); } catch { /* ignore */ }
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
    try { await child.status; } catch { /* ignore */ }
}

Deno.test("manager enqueue", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);

    mgr.enqueue("queue", "foo");
    mgr.enqueue("queue", "bar");

    assertEquals("foo", mgr.dequeue("queue"));
    assertEquals("bar", mgr.dequeue("queue"));
});

Deno.test("manager length", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);

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
    const persist = new Persistency.FileStore;
    persist.clear();
    persist.saveEvent("foo", "bar", true);
    persist.saveEvent("fee", "bat", true);
    persist.saveEvent("fee", "gat", true);
    persist.saveEvent("fee", "bat", false);

    const mgr = new QueueManager(persist);
    mgr.load();

    assertEquals([], persist.loadState());
    assertEquals(1, mgr.length("foo"));
    assertEquals("bar", mgr.dequeue("foo"));
    assertEquals(1, mgr.length("fee"));
    assertEquals("gat", mgr.dequeue("fee"));
    persist.close();
});

Deno.test("json persistency", () => {
    const persist = new Persistency.FileStore;
    const mgr = new QueueManager(persist);
    const payload = "php /var/www/html/index.php";

    persist.clear();
    persist.saveEvent("foo", payload, true);

    mgr.load();

    assertEquals([], persist.loadState());
    assertEquals(1, mgr.length("foo"));
    assertEquals(payload, mgr.dequeue("foo"));
    persist.close();
});

Deno.test("persistency", () => {
    const persist = new Persistency.FileStore;

    persist.clear();

    const load = (): string => new TextDecoder().decode(Deno.readFileSync("persist.dat"));

    assertEquals("", load());

    persist.saveEvent("foo", "bar", true);

    assertNotEquals("", load());

    persist.clear();
    persist.close();
});

Deno.test("concurrent enqueue writes to file", async () => {
    const persist = new Persistency.FileStore;
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
    const events = persist.loadState();

    // Should have exactly 10 enqueue operations
    assertEquals(10, events.length);

    // All lines should be valid JSON with enqueue=true
    events.forEach((obj: any) => {
        assertEquals(true, obj.enqueue);
        assertEquals("test_queue", obj.queue);
    });

    persist.clear();
    persist.close();
});

Deno.test("concurrent manager operations maintain data integrity", async () => {
    const persist = new Persistency.FileStore;
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
    persist.close();
});

Deno.test("persist operations handle I/O errors gracefully", () => {
    const persist = new Persistency.FileStore;
    // Set an invalid directory to trigger an I/O error
    persist.dir("/nonexistent/invalid/path");

    let errorThrown = false;
    try {
        persist.saveEvent("foo", "bar", true);
    } catch (_e) {
        errorThrown = true;
    }

    assertEquals(true, errorThrown);
    persist.close();
});


    Deno.test("manager dequeue from empty queue returns undefined", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);

    const result = mgr.dequeue("nonexistent");

    assertEquals(undefined, result);
});

Deno.test("manager cleans up empty queues to prevent unbounded growth", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore, 10000, 1);

    mgr.enqueue("transient", "foo");
    assertEquals(false, mgr.canCreateQueue()); // At limit

    mgr.dequeue("transient");
    assertEquals(true, mgr.canCreateQueue()); // Freed up by cleanup

    mgr.enqueue("another", "bar");
    assertEquals("bar", mgr.dequeue("another"));
});

Deno.test("dequeue from empty unknown queue does not remove auto-created queue", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore, 10000, 1);

    // Auto-creates an empty queue; was never non-empty so stays registered
    mgr.dequeue("never-existed");
    assertEquals(false, mgr.canCreateQueue());
});

Deno.test("enqueue after cleanup restores queue", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);

    mgr.enqueue("queue", "foo");
    mgr.dequeue("queue"); // cleanup

    mgr.enqueue("queue", "bar");
    assertEquals(1, mgr.length("queue"));
    assertEquals("bar", mgr.dequeue("queue"));
});

Deno.test("queue is removed only after last item is dequeued", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore, 10000, 1);

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
    const persist = new Persistency.FileStore;
    persist.clear();

    persist.saveEvent("tmp", "data", true);
    persist.saveEvent("tmp", "data", false);

    const mgr = new QueueManager(persist, 10000, 1);
    mgr.load();

    // After load, "tmp" was enqueued then dequeued -> empty -> removed
    assertEquals(true, mgr.canCreateQueue());

    mgr.enqueue("other", "value");
    assertEquals("value", mgr.dequeue("other"));
    persist.close();
});

Deno.test("empty dequeue does not add entry to persistence log", () => {
    const persist = new Persistency.FileStore;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.dequeue("empty-queue");

    const events = persist.loadState();
    assertEquals(events.length, 0);

    persist.clear();
    persist.close();
});

Deno.test("non-empty dequeue still adds entry to persistence log", () => {
    const persist = new Persistency.FileStore;
    persist.clear();

    const mgr = new QueueManager(persist);
    mgr.enqueue("myqueue", "item1");
    mgr.dequeue("myqueue");

    const events = persist.loadState();
    assertEquals(events.length, 2);

    const deqEntry = events[1];
    assertEquals(deqEntry.queue, "myqueue");
    assertEquals(deqEntry.payload, "item1");
    assertEquals(deqEntry.dequeue, true);
    assertEquals(deqEntry.enqueue, false);

    persist.clear();
    persist.close();
});

Deno.test("Manager<number> enqueue and dequeue numbers", () => {
    const mgr = new QueueManager<number>(new Persistency.MemoryStore());
    mgr.enqueue("nums", 100);
    mgr.enqueue("nums", 200);

    assertEquals(mgr.dequeue("nums"), 100);
    assertEquals(mgr.dequeue("nums"), 200);
});

Deno.test("Manager<object> enqueue and dequeue objects", () => {
    interface Task {
        priority: number;
        label: string;
    }

    const mgr = new QueueManager<Task>(new Persistency.MemoryStore());
    mgr.enqueue("tasks", { priority: 1, label: "urgent" });
    mgr.enqueue("tasks", { priority: 2, label: "normal" });

    const first = mgr.dequeue("tasks");
    assertEquals(first, { priority: 1, label: "urgent" });

    const second = mgr.dequeue("tasks");
    assertEquals(second, { priority: 2, label: "normal" });
});

Deno.test("Manager<string> remains compatible with string payloads", () => {
    const mgr = new QueueManager<string>(new Persistency.MemoryStore());
    mgr.enqueue("q", "hello");
    mgr.enqueue("q", "world");

    assertEquals(mgr.dequeue("q"), "hello");
    assertEquals(mgr.dequeue("q"), "world");
});

Deno.test("Manager: enqueue on unknown queue creates queue (catches registration)", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    assertEquals(mgr.length("new-queue"), 0);
    mgr.enqueue("new-queue", "item1");
    assertEquals(mgr.length("new-queue"), 1);
    const item = mgr.dequeue("new-queue");
    assertEquals(item, "item1");
});

Deno.test("Manager: dequeue on unknown queue doesn't break (catches null handling)", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const item = mgr.dequeue("nonexistent");
    assertEquals(item, undefined);
    assertEquals(mgr.length("nonexistent"), 0);
});

Deno.test("Manager: length on unknown queue returns 0 (catches null handling)", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    const length = mgr.length("brand-new-queue");
    assertEquals(length, 0);
});

Deno.test("Manager: separate queues don't interfere (catches queue isolation)", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore);
    mgr.enqueue("queue-a", "a-item");
    mgr.enqueue("queue-b", "b-item");
    assertEquals(mgr.length("queue-a"), 1);
    assertEquals(mgr.length("queue-b"), 1);
    assertEquals(mgr.dequeue("queue-a"), "a-item");
    assertEquals(mgr.length("queue-a"), 0);
    assertEquals(mgr.length("queue-b"), 1);
    assertEquals(mgr.dequeue("queue-b"), "b-item");
});

// ── Mutation coverage for manager.ts ──────────────────────────────────────────

Deno.test("QueueNameTooLongError has correct message and name", () => {
    const error = new QueueNameTooLongError();
    assertEquals(error.message, "Queue name too long");
    assertEquals(error.name, "QueueNameTooLongError");
});

Deno.test("manager canEnqueue validates queue name", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore());
    assertThrows(() => mgr.canEnqueue("x".repeat(129)), QueueNameTooLongError);
});

Deno.test("manager enqueue throws when queue depth limit reached", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore(), 2, 1000);
    mgr.enqueue("q", "a");
    mgr.enqueue("q", "b");
    assertThrows(() => mgr.enqueue("q", "c"), Error, "Queue depth limit reached");
});

Deno.test("manager persistEnabled=false skips saveEvent on enqueue", () => {
    const persist = new Persistency.MemoryStore();
    const mgr = new QueueManager(persist, 10000, 1000, false);
    mgr.enqueue("q", "item");
    assertEquals(persist.loadState().length, 0);
});

Deno.test("manager load throws when queue depth limit exceeded", () => {
    const persist = new Persistency.MemoryStore();
    persist.saveEvent("q", "a", true);
    persist.saveEvent("q", "b", true);
    const mgr = new QueueManager(persist, 1, 1000);
    assertThrows(() => mgr.load(), Error, "Queue depth limit reached");
});

Deno.test("manager load skips events with neither enqueue nor dequeue", () => {
    const persist = new Persistency.MemoryStore();
    persist.saveBatch([
        { queue: "q", payload: "a", enqueue: true, dequeue: false },
        { queue: "q", payload: "b", enqueue: false, dequeue: false },
    ]);
    const mgr = new QueueManager(persist);
    mgr.load();
    assertEquals(mgr.length("q"), 1);
    assertEquals(mgr.dequeue("q"), "a");
});

Deno.test("dequeue on registered-but-empty queue does not delete it", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore(), 10000, 1);
    mgr.length("auto-created"); // auto-registers empty queue
    mgr.dequeue("auto-created"); // wasRegistered=true, wasNonEmpty=false
    assertEquals(false, mgr.canCreateQueue()); // queue should still be registered
});

Deno.test("manager length auto-registers unknown queue", () => {
    const mgr = new QueueManager(new Persistency.MemoryStore(), 10000, 1);
    mgr.length("new-q");
    assertEquals(false, mgr.canCreateQueue()); // queue was auto-registered, at limit
});
