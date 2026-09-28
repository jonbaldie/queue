import { assertEquals } from "jsr:@std/assert@1.0";
import { parsePayloadBody, readAndValidatePayload } from "../src/payload.ts";
import type { JsonValue, Payload } from "../src/payload.ts";

const nestedJson: JsonValue = { object: null, array: [null] };
const acceptedPayload: Payload = { object: null, array: [null] };
const parsedPayload: Payload = parsePayloadBody('{"payload":{"object":null,"array":[null]}}');

function verifyPayloadReadersDoNotAcceptCallerSelectedTypes(): void {
    // @ts-expect-error Payload parsing does not accept a caller-selected return type.
    parsePayloadBody<string>('{"payload":42}');

    // @ts-expect-error Payload stream reading does not accept a caller-selected return type.
    readAndValidatePayload<string>(null);
}

// @ts-expect-error A payload reader cannot promise that arbitrary JSON is a string.
const mustNarrowBeforeUsingAsString: string = parsePayloadBody('{"payload":42}');

// @ts-expect-error Top-level null is rejected by the HTTP payload contract.
const topLevelNullIsNotPayload: Payload = null;

Deno.test("payload types allow nested null while excluding top-level null", () => {
    assertEquals(nestedJson, { object: null, array: [null] });
    assertEquals(acceptedPayload, parsedPayload);
    void verifyPayloadReadersDoNotAcceptCallerSelectedTypes;
    void mustNarrowBeforeUsingAsString;
    void topLevelNullIsNotPayload;
});
