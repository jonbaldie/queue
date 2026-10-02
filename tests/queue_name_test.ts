import { assertEquals, assertThrows } from "jsr:@std/assert@1.0";
import {
    InvalidQueueNameError,
    MAX_QUEUE_NAME_LENGTH,
    parseQueueName,
    QueueNameTooLongError,
    validateQueueName,
} from "../src/queue_name.ts";

Deno.test("queue name: MAX_QUEUE_NAME_LENGTH is 128", () => {
    assertEquals(MAX_QUEUE_NAME_LENGTH, 128);
});

Deno.test("queue name: InvalidQueueNameError has default message and name", () => {
    const error = new InvalidQueueNameError();
    assertEquals(error.message, "Invalid queue name");
    assertEquals(error.name, "InvalidQueueNameError");
});

Deno.test("queue name: QueueNameTooLongError has default message and name", () => {
    const error = new QueueNameTooLongError();
    assertEquals(error.message, "Queue name too long");
    assertEquals(error.name, "QueueNameTooLongError");
});

Deno.test("queue name: parse returns a plain name unchanged", () => {
    assertEquals(parseQueueName("orders"), "orders");
});

Deno.test("queue name: parse percent-decodes the raw name", () => {
    assertEquals(parseQueueName("my%20queue"), "my queue");
    assertEquals(parseQueueName("%F0%9F%98%80"), "😀");
});

Deno.test("queue name: parse decodes exactly once", () => {
    assertEquals(parseQueueName("%2541"), "%41");
});

Deno.test("queue name: parse rejects a missing name", () => {
    assertThrows(() => parseQueueName(undefined), InvalidQueueNameError, "Invalid queue name");
});

Deno.test("queue name: parse rejects an empty name", () => {
    assertThrows(() => parseQueueName(""), InvalidQueueNameError, "Invalid queue name");
});

Deno.test("queue name: parse rejects malformed percent-encoding", () => {
    assertThrows(() => parseQueueName("%"), InvalidQueueNameError, "Invalid queue name");
    assertThrows(() => parseQueueName("%E0%A4%A"), InvalidQueueNameError, "Invalid queue name");
    assertThrows(() => parseQueueName("%FF"), InvalidQueueNameError, "Invalid queue name");
});

Deno.test("queue name: parse measures length after decoding", () => {
    assertEquals(parseQueueName("%61".repeat(128)), "a".repeat(128));
    assertThrows(() => parseQueueName("%61".repeat(129)), QueueNameTooLongError, "Queue name too long");
});

Deno.test("queue name: validate accepts exactly MAX_QUEUE_NAME_LENGTH code points", () => {
    const name = "x".repeat(MAX_QUEUE_NAME_LENGTH);
    assertEquals(validateQueueName(name), name);
});

Deno.test("queue name: validate rejects MAX_QUEUE_NAME_LENGTH + 1 code points", () => {
    assertThrows(
        () => validateQueueName("x".repeat(MAX_QUEUE_NAME_LENGTH + 1)),
        QueueNameTooLongError,
        "Queue name too long",
    );
});

Deno.test("queue name: validate counts Unicode code points, not UTF-16 units", () => {
    const name128 = "😀".repeat(128);
    assertEquals(validateQueueName(name128), name128);
    assertThrows(() => validateQueueName("😀".repeat(129)), QueueNameTooLongError);
});

Deno.test("queue name: validate rejects an empty name", () => {
    assertThrows(() => validateQueueName(""), InvalidQueueNameError, "Invalid queue name");
});

Deno.test("queue name: validate does not percent-decode", () => {
    assertEquals(validateQueueName("%41"), "%41");
    assertEquals(validateQueueName("%"), "%");
});

Deno.test("queue name: validate accepts a single-character name", () => {
    assertEquals(validateQueueName("a"), "a");
});
