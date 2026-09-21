const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

export async function readRequestBody(request: Request): Promise<string | Response> {
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

function decodeUtf8(body: Uint8Array): string | Response {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
        // Not well-formed UTF-8 (RFC 8259 §8.1); rejecting beats storing U+FFFD.
        return new Response("Invalid JSON", { status: 400 });
    }
}
