export class InvalidPayloadError extends Error {
    constructor(message: string = "Invalid JSON") {
        super(message);
        this.name = "InvalidPayloadError";
    }
}

export class PayloadTooLargeError extends Error {
    constructor(message: string = "Payload too large") {
        super(message);
        this.name = "PayloadTooLargeError";
    }
}

export const DEFAULT_MAX_PAYLOAD_SIZE = 1024 * 1024; // 1 MB

export class JsonNestingTooDeepError extends Error {
    constructor(message: string = "Invalid JSON") {
        super(message);
        this.name = "JsonNestingTooDeepError";
    }
}

export class UnsupportedNumberError extends Error {
    constructor(message: string = "Payload contains an unsupported number") {
        super(message);
        this.name = "UnsupportedNumberError";
    }
}

export const MAX_JSON_DEPTH = 3000;

function canonicalJsonNumber(source: string): string {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
    if (match === null) {
        return source;
    }

    const sign = match[1] === "-" ? "-" : "";
    let digits = `${match[2]}${match[3] ?? ""}`.replace(/^0+/, "");
    if (digits === "") {
        return "0";
    }

    let exponent = Number(match[4] ?? "0") - (match[3]?.length ?? 0);
    const digitsWithoutTrailingZeros = digits.replace(/0+$/, "");
    exponent += digits.length - digitsWithoutTrailingZeros.length;
    digits = digitsWithoutTrailingZeros;
    return `${sign}${digits}e${exponent}`;
}

function isUnsupportedNumber(value: number, source: string): boolean {
    if (!Number.isFinite(value)) {
        return true;
    }

    const serializedValue = JSON.stringify(value)!;
    return canonicalJsonNumber(source) !== canonicalJsonNumber(serializedValue);
}

// Matches strings, containers, and number literals in valid JSON. Scanning
// the source avoids invoking a JSON.parse reviver once per JSON value.
const JSON_TOKEN = /"[^"\\]*(?:\\.[^"\\]*)*"|[[{]|[\]}]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
const EXACT_INTEGER = /^-?\d{1,15}$/;

function rejectUnsupportedNumber(source: string): void {
    // Every integer with at most 15 digits is below Number.MAX_SAFE_INTEGER.
    if (EXACT_INTEGER.test(source)) {
        return;
    }
    if (isUnsupportedNumber(Number(source), source)) {
        throw new UnsupportedNumberError();
    }
}

function validateJsonSource(source: string): void {
    let depth = 0;
    for (const match of source.matchAll(JSON_TOKEN)) {
        const token = match[0];
        if (token === "[" || token === "{") {
            depth++;
            if (depth > MAX_JSON_DEPTH) {
                throw new JsonNestingTooDeepError();
            }
        } else if (token === "]" || token === "}") {
            depth--;
        } else if (token[0] !== '"') {
            rejectUnsupportedNumber(token);
        }
    }
}

function decodePayloadBody(body: string | Uint8Array): string {
    if (typeof body === "string") {
        return body;
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
        throw new InvalidPayloadError("Invalid JSON");
    }
}

function parseAndValidateJson(text: string): unknown {
    try {
        const json = JSON.parse(text);
        validateJsonSource(text);
        return json;
    } catch (error) {
        if (error instanceof RangeError || error instanceof JsonNestingTooDeepError) {
            throw new JsonNestingTooDeepError();
        }
        if (error instanceof UnsupportedNumberError || error instanceof InvalidPayloadError) {
            throw error;
        }
        throw new InvalidPayloadError("Invalid JSON");
    }
}

function extractPayloadValue<T>(json: unknown): T {
    if (json === null || typeof json !== "object") {
        throw new InvalidPayloadError("Missing payload key");
    }
    if (!("payload" in json)) {
        throw new InvalidPayloadError("Missing payload key");
    }
    const payload = (json as Record<string, unknown>).payload;
    if (payload === null) {
        throw new InvalidPayloadError("Null payload not allowed");
    }
    return payload as T;
}

export function parsePayloadBody<T = unknown>(body: string | Uint8Array): T {
    const text = decodePayloadBody(body);
    const json = parseAndValidateJson(text);
    return extractPayloadValue<T>(json);
}

export async function readAndValidatePayload<T = unknown>(
    stream: ReadableStream<Uint8Array> | null,
    maxBytes: number = DEFAULT_MAX_PAYLOAD_SIZE,
): Promise<T> {
    if (stream === null) {
        return parsePayloadBody<T>("");
    }

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let bodySize = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            bodySize += value.byteLength;
            if (bodySize > maxBytes) {
                await reader.cancel();
                throw new PayloadTooLargeError();
            }
            chunks.push(value);
        }
    } catch (error) {
        if (error instanceof PayloadTooLargeError) {
            throw error;
        }
        try {
            await reader.cancel();
        } catch (cancelError) {
            // The stream may already be closed or errored.
            void cancelError;
        }
        throw new PayloadTooLargeError();
    } finally {
        reader.releaseLock();
    }

    const body = new Uint8Array(bodySize);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return parsePayloadBody<T>(body);
}

