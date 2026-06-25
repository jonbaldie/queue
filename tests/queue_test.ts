import { assertEquals, assertThrows } from "jsr:@std/assert";
import Queue from "../src/queue.ts";

Deno.test("Queue - accepts payloads up to its depth limit", () => {
    const queue = new Queue<string>([], 2);
    queue.enqueue("first");
    queue.enqueue("second");
    assertEquals(queue.length(), 2);
});

Deno.test("Queue - refuses payload when depth limit is reached", () => {
    const queue = new Queue<string>([], 2);
    queue.enqueue("first");
    queue.enqueue("second");
    
    assertThrows(() => {
        queue.enqueue("third");
    }, Error, "Queue depth limit reached");
});

Deno.test("Queue - operates without limit when no depth limit provided", () => {
    const queue = new Queue<string>([]);
    for (let i = 0; i < 1000; i++) {
        queue.enqueue(`item-${i}`);
    }
    assertEquals(queue.length(), 1000);
});

Deno.test("Queue - hasCapacity returns true if below depth limit", () => {
    const queue = new Queue<string>([], 2);
    queue.enqueue("first");
    assertEquals(queue.hasCapacity(), true);
});

Deno.test("Queue - hasCapacity returns false if at depth limit", () => {
    const queue = new Queue<string>([], 2);
    queue.enqueue("first");
    queue.enqueue("second");
    assertEquals(queue.hasCapacity(), false);
});

Deno.test("Queue - hasCapacity returns true if no depth limit", () => {
    const queue = new Queue<string>([]);
    for (let i = 0; i < 1000; i++) {
        queue.enqueue(`item-${i}`);
    }
    assertEquals(queue.hasCapacity(), true);
});
