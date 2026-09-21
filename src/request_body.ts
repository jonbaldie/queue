const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

class UnsupportedNumberError extends Error {
    constructor() {
        super("Payload contains an unsupported number");
    }
}

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

function parseJsonBody(body: string) {
    return JSON.parse(body, function (key: string, value: unknown) {
        void key;
        if (typeof value !== "number") {
            return value;
        }

        // V8 supplies context.source at runtime; Deno's JSON.parse type still
        // only declares the legacy two-argument reviver signature.
        const context = arguments[2] as { source: string };
        if (isUnsupportedNumber(value, context.source)) {
            throw new UnsupportedNumberError();
        }
        return value;
    });
}

function decodeUtf8(body: Uint8Array): string | Response {
    try {
        // Fatal decoding rejects malformed UTF-8 instead of silently storing U+FFFD.
        return UTF8_DECODER.decode(body);
    } catch {
        return new Response("Invalid JSON", { status: 400 });
    }
}

async function readRequestBody(request: Request): Promise<string | Response> {
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
        return new Response("Payload too large", { status: 413 });
    }

    if (request.body === null) {
        return "";
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let bodySize = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            bodySize += value.byteLength;
            if (bodySize > MAX_BODY_SIZE) {
                await reader.cancel();
                return new Response("Payload too large", { status: 413 });
            }
            chunks.push(value);
        }
    } catch {
        try {
            await reader.cancel();
        } catch (error) {
            // The stream may already be closed or errored.
            void error;
        }
        return new Response("Payload too large", { status: 413 });
    } finally {
        reader.releaseLock();
    }

    const body = new Uint8Array(bodySize);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return decodeUtf8(body);
}

export async function readJsonBody(request: Request): Promise<{ json: ReturnType<typeof JSON.parse> } | Response> {
    const body = await readRequestBody(request);
    if (body instanceof Response) {
        return body;
    }
    try {
        return { json: parseJsonBody(body) };
    } catch (error) {
        if (error instanceof UnsupportedNumberError) {
            return new Response(error.message, { status: 400 });
        }
        if (error instanceof SyntaxError) {
            return new Response("Invalid JSON", { status: 400 });
        }
        throw error;
    }
}
