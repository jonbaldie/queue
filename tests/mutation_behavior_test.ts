/**
 * Mutation Testing & Public Interface Behavior Tests
 *
 * This test suite is designed to:
 * 1. Catch mutations in core logic (boundary conditions, off-by-one, operator changes)
 * 2. Thoroughly test public API behavior with edge cases
 * 3. Validate state transitions and queue invariants
 * 4. Test error conditions and malformed inputs
 */

import { assertEquals } from "jsr:@std/assert";
import * as Persistency from "../src/persist.ts";
import Queue from "../src/queue.ts";
import QueueManager from "../src/manager.ts";
import { createHandler } from "../src/handler.ts";

// ==============================================================================
// QUEUE MUTATION TESTS - Test core queue logic against mutations
// ==============================================================================

Deno.test("Queue: length is 0 when empty (catches length mutation)", () => {
    const queue = new Queue([]);
    assertEquals(queue.length(), 0);
});

Deno.test("Queue: length increases by 1 for each enqueue (catches off-by-one)", () => {
    const queue = new Queue([]);
    assertEquals(queue.length(), 0);

    queue.enqueue("a");
    assertEquals(queue.length(), 1);

    queue.enqueue("b");
    assertEquals(queue.length(), 2);

    queue.enqueue("c");
    assertEquals(queue.length(), 3);
});

Deno.test("Queue: dequeue returns undefined on empty queue (catches mutation)", () => {
    const queue = new Queue([]);
    assertEquals(queue.dequeue(), undefined);
});

Deno.test("Queue: dequeue returns FIFO order (catches order mutations)", () => {
    const queue = new Queue([]);
    queue.enqueue("first");
    queue.enqueue("second");
    queue.enqueue("third");

    assertEquals(queue.dequeue(), "first");
    assertEquals(queue.dequeue(), "second");
    assertEquals(queue.dequeue(), "third");
    assertEquals(queue.dequeue(), undefined);
});

Deno.test("Queue: length decreases after dequeue (catches mutation)", () => {
    const queue = new Queue([]);
    queue.enqueue("a");
    queue.enqueue("b");
    assertEquals(queue.length(), 2);

    queue.dequeue();
    assertEquals(queue.length(), 1);

    queue.dequeue();
    assertEquals(queue.length(), 0);
});

Deno.test("Queue: is_empty true only when length is 0 (catches boundary)", () => {
    const queue = new Queue([]);
    assertEquals(queue.is_empty(), true);

    queue.enqueue("a");
    assertEquals(queue.is_empty(), false);

    queue.dequeue();
    assertEquals(queue.is_empty(), true);
});

Deno.test("Queue: is_empty reflects actual state (catches negation mutation)", () => {
    const queue = new Queue([]);
    assertEquals(queue.is_empty(), true);

    queue.enqueue("item");
    assertEquals(queue.is_empty(), false);
});

Deno.test("Queue: peek returns first element value", () => {
    const queue = new Queue(["first", "second", "third"]);
    const peeked = queue.peek();
    assertEquals(peeked, "first");

    // Verify items are still in queue
    assertEquals(queue.length(), 3);
});

Deno.test("Queue: peek on empty queue returns undefined (catches mutation)", () => {
    const queue = new Queue([]);
    assertEquals(queue.peek(), undefined);
});

// ==============================================================================
// MANAGER MUTATION TESTS - Test manager logic and state
// ==============================================================================

Deno.test("Manager: enqueue on unknown queue creates queue (catches registration)", () => {
    const mgr = new QueueManager(new Persistency.None);
    assertEquals(mgr.length("new-queue"), 0);
    mgr.enqueue("new-queue", "item1");
    assertEquals(mgr.length("new-queue"), 1);
    const item = mgr.dequeue("new-queue");
    assertEquals(item, "item1");
});

Deno.test("Manager: dequeue on unknown queue doesn't break (catches null handling)", () => {
    const mgr = new QueueManager(new Persistency.None);
    const item = mgr.dequeue("nonexistent");
    assertEquals(item, undefined);
    assertEquals(mgr.length("nonexistent"), 0);
});

Deno.test("Manager: length on unknown queue returns 0 (catches null handling)", () => {
    const mgr = new QueueManager(new Persistency.None);
    const length = mgr.length("brand-new-queue");
    assertEquals(length, 0);
});

Deno.test("Manager: separate queues don't interfere (catches queue isolation)", () => {
    const mgr = new QueueManager(new Persistency.None);
    mgr.enqueue("queue-a", "a-item");
    mgr.enqueue("queue-b", "b-item");
    assertEquals(mgr.length("queue-a"), 1);
    assertEquals(mgr.length("queue-b"), 1);
    assertEquals(mgr.dequeue("queue-a"), "a-item");
    assertEquals(mgr.length("queue-a"), 0);
    assertEquals(mgr.length("queue-b"), 1);
    assertEquals(mgr.dequeue("queue-b"), "b-item");
});

Deno.test("Manager: enqueue followed by multiple dequeues (catches state corruption)", () => {
    const mgr = new QueueManager(new Persistency.None);
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

function makeHandler() {
    const mgr = new QueueManager(new Persistency.None);
    return createHandler(mgr, TEST_TOKEN);
}

Deno.test("API: enqueue with valid token returns 200 (catches auth mutation)", async () => {
    const handler = makeHandler();
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
    const handler = makeHandler();
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
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/length/q", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 200);
});

Deno.test("API: enqueue without token returns 401 (catches auth bypass)", async () => {
    const handler = makeHandler();
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
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/dequeue/test", {
            headers: { "Authorization": `Bearer wrong-token` },
        })
    );
    assertEquals(res.status, 401);
});

Deno.test("API: length without token returns 401 (catches auth bypass)", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/length/test")
    );
    assertEquals(res.status, 401);
});

Deno.test("API: enqueue stores payload and dequeue retrieves it (catches data loss)", async () => {
    const handler = makeHandler();
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
    const retrieved = await deqRes.text();
    assertEquals(retrieved, payload);
});

Deno.test("API: dequeue empty queue returns 204 (catches crash)", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/dequeue/empty-queue", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 204);
    // Mutation check: if dequeue crashes or returns wrong value
});

Deno.test("API: length returns numeric string (catches type mutation)", async () => {
    const handler = makeHandler();
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
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/unknown/path", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 404);
});

Deno.test("API: GET request to enqueue is rejected (catches method check)", async () => {
    const handler = makeHandler();
    const res = await handler(
        new Request("http://localhost/enqueue/q", {
            method: "GET",
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(res.status, 405);
});

Deno.test("API: POST request to dequeue is rejected (catches method check)", async () => {
    const handler = makeHandler();
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
    const handler = makeHandler();
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
    const handler = makeHandler();
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
        const actual = await res.text();
        assertEquals(actual, expected);
    }
});

Deno.test("API: multiple queues isolated (catches queue mixing)", async () => {
    const handler = makeHandler();
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
    assertEquals(await res1.text(), "q1-item");
    const res2 = await handler(
        new Request("http://localhost/dequeue/q2", {
            headers: { "Authorization": `Bearer ${TEST_TOKEN}` },
        })
    );
    assertEquals(await res2.text(), "q2-item");
});

Deno.test("API: enqueue with empty payload (catches validation)", async () => {
    const handler = makeHandler();
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
    const handler = makeHandler();
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
    const retrieved = await deqRes.text();
    assertEquals(retrieved, longPayload);
});
