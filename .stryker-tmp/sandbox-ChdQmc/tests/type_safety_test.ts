// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1.0";
import Queue from "../src/queue.ts";
import QueueManager from "../src/manager.ts";
import * as Persistency from "../src/persist.ts";

// ==============================================================================
// TYPE SAFETY TESTS - Verify Queue<T> respects generic parameter
// ==============================================================================

Deno.test("Queue<number> stores numbers", () => {
    const queue = new Queue<number>([]);
    queue.enqueue(42);
    queue.enqueue(99);

    const first = queue.dequeue();
    assertEquals(first, 42);
    assertEquals(typeof first, "number");

    const second = queue.dequeue();
    assertEquals(second, 99);
    assertEquals(typeof second, "number");
});

Deno.test("Queue<object> stores objects", () => {
    interface Item {
        id: number;
        name: string;
    }

    const queue = new Queue<Item>([]);
    queue.enqueue({ id: 1, name: "first" });
    queue.enqueue({ id: 2, name: "second" });

    const first = queue.dequeue();
    assertEquals(first, { id: 1, name: "first" });

    const second = queue.dequeue();
    assertEquals(second, { id: 2, name: "second" });
});

Deno.test("Queue<number> peek returns number", () => {
    const queue = new Queue<number>([10, 20, 30]);
    const peeked = queue.peek();
    assertEquals(peeked, 10);
    assertEquals(typeof peeked, "number");
});

Deno.test("Queue<number> all() returns Array<number>", () => {
    const queue = new Queue<number>([1, 2, 3]);
    const all = queue.all();
    assertEquals(all, [1, 2, 3]);
    // Verify it's a copy
    all.push(4);
    assertEquals(queue.length(), 3);
});

Deno.test("Queue<boolean> stores booleans", () => {
    const queue = new Queue<boolean>([]);
    queue.enqueue(true);
    queue.enqueue(false);

    assertEquals(queue.dequeue(), true);
    assertEquals(queue.dequeue(), false);
});

Deno.test("Manager<number> enqueue and dequeue numbers", () => {
    const mgr = new QueueManager<number>(new Persistency.None());
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

    const mgr = new QueueManager<Task>(new Persistency.None());
    mgr.enqueue("tasks", { priority: 1, label: "urgent" });
    mgr.enqueue("tasks", { priority: 2, label: "normal" });

    const first = mgr.dequeue("tasks");
    assertEquals(first, { priority: 1, label: "urgent" });

    const second = mgr.dequeue("tasks");
    assertEquals(second, { priority: 2, label: "normal" });
});

Deno.test("Manager<string> remains compatible with string payloads", () => {
    const mgr = new QueueManager<string>(new Persistency.None());
    mgr.enqueue("q", "hello");
    mgr.enqueue("q", "world");

    assertEquals(mgr.dequeue("q"), "hello");
    assertEquals(mgr.dequeue("q"), "world");
});
