import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0";
import {
    DEFAULT_MAX_PAYLOAD_SIZE,
    InvalidPayloadError,
    JsonNestingTooDeepError,
    MAX_JSON_DEPTH,
    parsePayloadBody,
    PayloadTooLargeError,
    readAndValidatePayload,
    UnsupportedNumberError,
} from "../src/payload.ts";

Deno.test("payload: parses valid payload from JSON string", () => {
    const result = parsePayloadBody<string>('{"payload":"hello world"}');
    assertEquals(result, "hello world");
});

Deno.test("payload: rejects JSON without payload key", () => {
    const error = assertThrows(
        () => parsePayloadBody('{"data":"hello"}'),
        InvalidPayloadError,
        "Missing payload key",
    );
    assertEquals(error.message, "Missing payload key");
});

Deno.test("payload: rejects non-object JSON", () => {
    const error = assertThrows(
        () => parsePayloadBody('"just a string"'),
        InvalidPayloadError,
        "Missing payload key",
    );
    assertEquals(error.message, "Missing payload key");
});

Deno.test("payload: rejects null payload", () => {
    const error = assertThrows(
        () => parsePayloadBody('{"payload":null}'),
        InvalidPayloadError,
        "Null payload not allowed",
    );
    assertEquals(error.message, "Null payload not allowed");
});

Deno.test("payload: rejects malformed JSON string", () => {
    const error = assertThrows(
        () => parsePayloadBody('{invalid json}'),
        InvalidPayloadError,
        "Invalid JSON",
    );
    assertEquals(error.message, "Invalid JSON");
});

Deno.test("payload: parses valid UTF-8 Uint8Array payload", () => {
    const bytes = new TextEncoder().encode('{"payload":"héllo 🌍"}');
    const result = parsePayloadBody<string>(bytes);
    assertEquals(result, "héllo 🌍");
});

Deno.test("payload: rejects invalid UTF-8 bytes", () => {
    const invalidUtf8 = Uint8Array.of(
        ...new TextEncoder().encode('{"payload":"caf'),
        0xe9,
        ...new TextEncoder().encode('"}'),
    );
    const error = assertThrows(
        () => parsePayloadBody(invalidUtf8),
        InvalidPayloadError,
        "Invalid JSON",
    );
    assertEquals(error.message, "Invalid JSON");
});

Deno.test("payload: accepts nesting within limit", () => {
    const depth = 50;
    const nested = `${"[".repeat(depth)}${"]".repeat(depth)}`;
    const result = parsePayloadBody(`{"payload":${nested}}`);
    assertEquals(Array.isArray(result), true);
});

Deno.test("payload: accepts nesting at exactly MAX_JSON_DEPTH", () => {
    // 1 level for outer {"payload": ...} + (MAX_JSON_DEPTH - 1) levels = MAX_JSON_DEPTH
    const depth = MAX_JSON_DEPTH - 1;
    const nested = `${"[".repeat(depth)}${"]".repeat(depth)}`;
    const result = parsePayloadBody(`{"payload":${nested}}`);
    assertEquals(Array.isArray(result), true);
});

Deno.test("payload: rejects nesting exceeding MAX_JSON_DEPTH", () => {
    // 1 level for outer {"payload": ...} + MAX_JSON_DEPTH levels = MAX_JSON_DEPTH + 1
    const depth = MAX_JSON_DEPTH;
    const nested = `${"[".repeat(depth)}${"]".repeat(depth)}`;
    assertThrows(
        () => parsePayloadBody(`{"payload":${nested}}`),
        JsonNestingTooDeepError,
    );
});

Deno.test("payload: rejects nesting causing parser stack overflow (RangeError)", () => {
    const depth = 100_000;
    const nested = `${"[".repeat(depth)}${"]".repeat(depth)}`;
    assertThrows(
        () => parsePayloadBody(`{"payload":${nested}}`),
        JsonNestingTooDeepError,
    );
});

Deno.test("payload: accepts valid and safe numbers", () => {
    assertEquals(parsePayloadBody('{"payload":42}'), 42);
    assertEquals(parsePayloadBody('{"payload":-123456789012345}'), -123456789012345);
    assertEquals(parsePayloadBody('{"payload":9007199254740992}'), 9007199254740992);
    assertEquals(parsePayloadBody('{"payload":1.5}'), 1.5);
    assertEquals(parsePayloadBody('{"payload":1e3}'), 1000);
});

Deno.test("payload: rejects non-finite number literals", () => {
    assertThrows(
        () => parsePayloadBody('{"payload":1e400}'),
        UnsupportedNumberError,
        "Payload contains an unsupported number",
    );
});

Deno.test("payload: rejects unsafe integers with precision loss", () => {
    assertThrows(
        () => parsePayloadBody('{"payload":9007199254740993}'),
        UnsupportedNumberError,
        "Payload contains an unsupported number",
    );
});

Deno.test("payload: rejects underflowing numbers", () => {
    assertThrows(
        () => parsePayloadBody('{"payload":1e-400}'),
        UnsupportedNumberError,
        "Payload contains an unsupported number",
    );
});

Deno.test("payload: rejects inexact decimal numbers that lose precision", () => {
    assertThrows(
        () => parsePayloadBody('{"payload":1.234567890123456789}'),
        UnsupportedNumberError,
        "Payload contains an unsupported number",
    );
});

Deno.test("readAndValidatePayload: rejects null stream as InvalidPayloadError", async () => {
    await assertRejects(
        () => readAndValidatePayload(null),
        InvalidPayloadError,
        "Invalid JSON",
    );
});

Deno.test("readAndValidatePayload: reads and parses stream within size limit", async () => {
    const bytes = new TextEncoder().encode('{"payload":"streamed-data"}');
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
    const result = await readAndValidatePayload<string>(stream);
    assertEquals(result, "streamed-data");
});

Deno.test("readAndValidatePayload: reassembles payload split across multiple chunks", async () => {
    const part1 = new TextEncoder().encode('{"pay');
    const part2 = new TextEncoder().encode('load":"multi-');
    const part3 = new TextEncoder().encode('chunk"}');
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(part1);
            controller.enqueue(part2);
            controller.enqueue(part3);
            controller.close();
        },
    });
    const result = await readAndValidatePayload<string>(stream);
    assertEquals(result, "multi-chunk");
});


Deno.test("readAndValidatePayload: respects custom maxBytes limit", async () => {
    const bytes = new TextEncoder().encode('{"payload":"12345"}');
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
    // Stream size is 19 bytes. Set maxBytes to 10.
    await assertRejects(
        () => readAndValidatePayload(stream, 10),
        PayloadTooLargeError,
        "Payload too large",
    );
});

Deno.test("readAndValidatePayload: rejects stream when size limit is exceeded", async () => {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(50));
            controller.enqueue(new Uint8Array(50));
        },
    });
    await assertRejects(
        () => readAndValidatePayload(stream, 40),
        PayloadTooLargeError,
        "Payload too large",
    );
});

Deno.test("readAndValidatePayload: throws PayloadTooLargeError when stream errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(10));
            controller.error(new Error("network error"));
        },
    });
    await assertRejects(
        () => readAndValidatePayload(stream),
        PayloadTooLargeError,
        "Payload too large",
    );
});

Deno.test("readAndValidatePayload: accepts exactly 1 MiB payload", async () => {
    const emptyPayloadBody = '{"payload":""}';
    const bodyText = `{"payload":"${"x".repeat(DEFAULT_MAX_PAYLOAD_SIZE - emptyPayloadBody.length)}"}`;
    const bodyBytes = new TextEncoder().encode(bodyText);
    assertEquals(bodyBytes.byteLength, DEFAULT_MAX_PAYLOAD_SIZE);

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
        },
    });
    const result = await readAndValidatePayload<string>(stream);
    assertEquals(typeof result, "string");
    assertEquals(result.length, DEFAULT_MAX_PAYLOAD_SIZE - emptyPayloadBody.length);
});

Deno.test("readAndValidatePayload: rejects exactly 1 MiB + 1 byte", async () => {
    const emptyPayloadBody = '{"payload":""}';
    const bodyText = `{"payload":"${"x".repeat(DEFAULT_MAX_PAYLOAD_SIZE - emptyPayloadBody.length + 1)}"}`;
    const bodyBytes = new TextEncoder().encode(bodyText);
    assertEquals(bodyBytes.byteLength, DEFAULT_MAX_PAYLOAD_SIZE + 1);

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bodyBytes);
            controller.close();
        },
    });
    await assertRejects(
        () => readAndValidatePayload(stream),
        PayloadTooLargeError,
        "Payload too large",
    );
});




