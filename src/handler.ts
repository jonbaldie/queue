import QueueManager, { QueueNameTooLongError } from "./manager.ts";
import { RateLimiter } from "./rate_limiter.ts";
import { withAuth, withRateLimit } from "./middleware.ts";
import { RouteHandler, Router } from "./router.ts";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const LOG_ENCODER = new TextEncoder();

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

// Every integer with at most 15 digits is below Number.MAX_SAFE_INTEGER, so
// it round-trips exactly without the canonical comparison.
const MAX_EXACT_INTEGER_DIGITS = 15;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const MINUS = 0x2d;

function isDigit(code: number): boolean {
    return code >= 0x30 && code <= 0x39;
}

function isNumberStart(code: number): boolean {
    return code === MINUS || isDigit(code);
}

function isNumberPart(code: number): boolean {
    // Digits plus . e E + -
    return isDigit(code) || code === 0x2e || code === 0x65 || code === 0x45 || code === 0x2b || code === MINUS;
}

function jsonStringEnd(body: string, openingQuote: number): number {
    let closingQuote = body.indexOf('"', openingQuote + 1);
    while (isEscaped(body, closingQuote)) {
        closingQuote = body.indexOf('"', closingQuote + 1);
    }
    return closingQuote + 1;
}

function isEscaped(body: string, index: number): boolean {
    let backslashes = 0;
    while (body.charCodeAt(index - backslashes - 1) === BACKSLASH) {
        backslashes++;
    }
    return backslashes % 2 === 1;
}

function isExactIntegerSource(body: string, start: number, end: number): boolean {
    const digitsStart = body.charCodeAt(start) === MINUS ? start + 1 : start;
    if (end - digitsStart > MAX_EXACT_INTEGER_DIGITS) {
        return false;
    }
    for (let index = digitsStart; index < end; index++) {
        if (!isDigit(body.charCodeAt(index))) {
            return false;
        }
    }
    return true;
}

function jsonNumberEnd(body: string, start: number): number {
    let end = start + 1;
    while (isNumberPart(body.charCodeAt(end))) {
        end++;
    }
    if (!isExactIntegerSource(body, start, end)) {
        const source = body.slice(start, end);
        if (isUnsupportedNumber(Number(source), source)) {
            throw new UnsupportedNumberError();
        }
    }
    return end;
}

// Scans already-validated JSON text and checks every number lexeme outside
// strings. A JSON.parse reviver would do the same per value, but invoking it
// for every leaf costs orders of magnitude more CPU on number-dense bodies.
function assertSupportedNumbers(body: string): void {
    let index = 0;
    while (index < body.length) {
        const code = body.charCodeAt(index);
        if (code === QUOTE) {
            index = jsonStringEnd(body, index);
        } else if (isNumberStart(code)) {
            index = jsonNumberEnd(body, index);
        } else {
            index++;
        }
    }
}

function parseJsonBody(body: string) {
    const json = JSON.parse(body);
    assertSupportedNumbers(body);
    return json;
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
    return await new Response(body).text();
}

function extractQueueName(match: Parameters<RouteHandler>[1]): { name: string } | { error: Response } {
    const raw = match.pathname.groups.queue;
    if (raw === undefined) {
        return { error: new Response("Invalid queue name", { status: 400 }) };
    }
    try {
        return { name: decodeURIComponent(raw) };
    } catch (error) {
        if (error instanceof URIError) {
            return { error: new Response("Invalid queue name", { status: 400 }) };
        }
        throw error;
    }
}

function enqueueHandler(mgr: QueueManager<string>): RouteHandler {
    return async (request, match) => {
        const queueResult = extractQueueName(match);
        if ("error" in queueResult) {
            return queueResult.error;
        }
        const queueName = queueResult.name;
        const body = await readRequestBody(request);
        if (body instanceof Response) {
            return body;
        }
        try {
            const json = parseJsonBody(body);
            if (json === null || typeof json !== "object") {
                return new Response("Missing payload key", { status: 400 });
            }
            if (!("payload" in json)) {
                return new Response("Missing payload key", { status: 400 });
            }
            if (json.payload === null) {
                return new Response("Null payload not allowed", { status: 400 });
            }
            if (!mgr.canEnqueue(queueName)) {
                return new Response("Queue full or too many queues", { status: 507 });
            }
            mgr.enqueue(queueName, json.payload);
            return new Response(`Payload successfully queued onto ${queueName}.`);
        } catch (error) {
            return enqueueErrorResponse(error);
        }
    };
}

function enqueueErrorResponse(error: unknown): Response {
    if (error instanceof SyntaxError) {
        return new Response("Invalid JSON", { status: 400 });
    }
    if (error instanceof UnsupportedNumberError) {
        return new Response(error.message, { status: 400 });
    }
    return queueNameErrorResponse(error);
}

function queueNameErrorResponse(error: unknown): Response {
    if (error instanceof QueueNameTooLongError) {
        return new Response("Queue name too long", { status: 400 });
    }
    throw error;
}

function itemResponse(item: unknown): Response {
    if (item === undefined) {
        return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(item), {
        headers: { "Content-Type": "application/json" },
    });
}

function dequeueHandler(mgr: QueueManager<string>): RouteHandler {
    return (request, match) => {
        void request;
        const queueResult = extractQueueName(match);
        if ("error" in queueResult) {
            return queueResult.error;
        }
        try {
            const item = request.method === "HEAD"
                ? mgr.peek(queueResult.name)
                : mgr.dequeue(queueResult.name);
            return itemResponse(item);
        } catch (error) {
            return queueNameErrorResponse(error);
        }
    };
}

function peekHandler(mgr: QueueManager<string>): RouteHandler {
    return (request, match) => {
        void request;
        const queueResult = extractQueueName(match);
        if ("error" in queueResult) {
            return queueResult.error;
        }
        try {
            return itemResponse(mgr.peek(queueResult.name));
        } catch (error) {
            return queueNameErrorResponse(error);
        }
    };
}

function lengthHandler(mgr: QueueManager<string>): RouteHandler {
    return (request, match) => {
        void request;
        const queueResult = extractQueueName(match);
        if ("error" in queueResult) {
            return queueResult.error;
        }
        try {
            const length = mgr.length(queueResult.name);
            return new Response(`${length}`);
        } catch (error) {
            return queueNameErrorResponse(error);
        }
    };
}

function registerRoutes(router: Router, mgr: QueueManager<string>): void {
    router.get("/health{/}?", () => {
        return new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    router.get("/queues", () => {
        return new Response(JSON.stringify(mgr.listQueues()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    router.post("/enqueue/:queue", enqueueHandler(mgr));
    router.get("/dequeue/:queue", dequeueHandler(mgr));
    router.get("/peek/:queue", peekHandler(mgr));
    router.get("/length/:queue", lengthHandler(mgr));
}

function writeLog(destination: { writeSync(data: Uint8Array): number }, message: string): void {
    destination.writeSync(LOG_ENCODER.encode(`${message}\n`));
}

export function createHandler(
    mgr: QueueManager<string>,
    apiToken: string,
    rateLimitRequests?: number,
) {
    const rateLimiter = new RateLimiter(rateLimitRequests ?? 100);
    const router = new Router();
    registerRoutes(router, mgr);
    const handlerWithAuth = withAuth(apiToken)(router.handle);
    const handlerWithRateLimit = withRateLimit(rateLimiter)(handlerWithAuth);

    return async function handler(
        request: Request,
        info?: Deno.ServeHandlerInfo,
    ): Promise<Response> {
        const start = performance.now();
        try {
            const response = await handlerWithRateLimit(request, info);
            const duration = performance.now() - start;
            writeLog(
                Deno.stdout,
                `${request.method} ${request.url} ${response.status} ${duration.toFixed(2)}ms`,
            );
            return response;
        } catch (error) {
            const duration = performance.now() - start;
            writeLog(
                Deno.stderr,
                `${request.method} ${request.url} 500 ${duration.toFixed(2)}ms`,
            );
            throw error;
        }
    };
}
