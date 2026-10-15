import { assertEquals, assertThrows } from "jsr:@std/assert@1.0";
import QueueManager, { MAX_QUEUE_NAME_LENGTH } from "../src/manager.ts";
import { FileStore } from "../src/persist.ts";
import { createHandler } from "../src/handler.ts";
import { InvalidPayloadError, type Payload } from "../src/payload.ts";

Deno.test("replay drops null payloads without shifting their FIFO slots", async () => {
    const dir = Deno.makeTempDirSync();
    const store = new FileStore<Payload>();
    store.dir(dir);
    try {
        Deno.writeTextFileSync(`${dir}/persist.dat`, [
            { queue: "nulls", payload: null, enqueue: true, dequeue: false },
            { queue: "q", payload: null, enqueue: true, dequeue: false },
            { queue: "q", payload: "a", enqueue: true, dequeue: false },
            // A dequeue consumes a slot regardless of its payload field.
            { queue: "q", payload: null, enqueue: false, dequeue: true },
            { queue: "q", payload: null, enqueue: true, dequeue: false },
            { queue: "q", payload: "b", enqueue: true, dequeue: false },
        ].map((event) => JSON.stringify(event)).join("\n"));
        const manager = new QueueManager(store);
        manager.load();
        assertEquals(manager.listQueues(), ["q"]);
        assertEquals(manager.length("q"), 2);
        assertEquals(manager.peek("q"), "a");
        assertEquals(manager.peek("nulls"), undefined);
        const handler = createHandler(manager, "test-token", 100);
        const response = await handler(new Request("http://localhost/dequeue/nulls", {
            headers: { Authorization: "Bearer test-token" },
        }));
        assertEquals(response.status, 204);
        await response.text();
        const restarted = new QueueManager(store);
        restarted.load();
        assertEquals(restarted.dequeue("q"), "a");
        assertEquals(restarted.dequeue("q"), "b");
        assertEquals(restarted.listQueues(), []);
        assertEquals(Deno.readTextFileSync(`${dir}/persist.dat`).includes('"payload":null'), false);
        // The same top-level payload rule also applies to direct live calls.
        const nullableManager = new QueueManager<string | null>(new FileStore<string | null>(), undefined, undefined, false);
        assertThrows(() => nullableManager.enqueue("nulls", null), InvalidPayloadError);
    } finally {
        store.close();
        Deno.removeSync(dir, { recursive: true });
    }
});

Deno.test("replay consumes the invalid item's slot rather than the next valid item", () => {
    const dir = Deno.makeTempDirSync();
    const store = new FileStore<Payload>();
    store.dir(dir);
    try {
        Deno.writeTextFileSync(`${dir}/persist.dat`, [
            '{"queue":"q","payload":null,"enqueue":true,"dequeue":false}',
            '{"queue":"q","payload":"a","enqueue":true,"dequeue":false}',
            '{"queue":"q","payload":"ignored","enqueue":false,"dequeue":true}',
        ].join("\n"));
        const manager = new QueueManager(store);
        manager.load();
        assertEquals(manager.length("q"), 1);
        assertEquals(manager.dequeue("q"), "a");
        assertEquals(manager.listQueues(), []);
    } finally {
        store.close();
        Deno.removeSync(dir, { recursive: true });
    }
});

Deno.test("replay rejects unreachable names and removes them from the snapshot", async () => {
    const dir = Deno.makeTempDirSync();
    const store = new FileStore<Payload>();
    store.dir(dir);
    try {
        const boundary = "😀".repeat(MAX_QUEUE_NAME_LENGTH);
        const invalid = boundary + "😀";
        Deno.writeTextFileSync(`${dir}/persist.dat`, JSON.stringify({
            queue: invalid, payload: "x", enqueue: true, dequeue: false,
        }) + "\n");
        const manager = new QueueManager(store, 10, 1);
        manager.load();
        assertEquals(manager.listQueues(), []);
        const handler = createHandler(manager, "test-token", 100);
        const response = await handler(new Request("http://localhost/queues", {
            headers: { Authorization: "Bearer test-token" },
        }));
        assertEquals(response.status, 200);
        assertEquals(await response.json(), []);
        assertEquals(Deno.readTextFileSync(`${dir}/persist.dat`), "");
        manager.enqueue(boundary, "boundary");
        manager.save();
        const restarted = new QueueManager(store);
        restarted.load();
        assertEquals(restarted.listQueues(), [boundary]);
        assertEquals(restarted.dequeue(boundary), "boundary");
    } finally {
        store.close();
        Deno.removeSync(dir, { recursive: true });
    }
});
