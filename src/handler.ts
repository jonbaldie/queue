import QueueManager from "./manager.ts";
import { RateLimiter } from "./rate_limiter.ts";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const MAX_QUEUE_NAME_LENGTH = 128;

const enqueuePattern = new URLPattern({ pathname: "/enqueue/:queue" });
const dequeuePattern = new URLPattern({ pathname: "/dequeue/:queue" });
const peekPattern = new URLPattern({ pathname: "/peek/:queue" });
const lengthPattern = new URLPattern({ pathname: "/length/:queue" });
const healthPattern = new URLPattern({ pathname: "/health" });
const queuesPattern = new URLPattern({ pathname: "/queues" });

function detectContentType(body: string): string {
    try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed) || (parsed !== null && typeof parsed === "object")) {
            return "application/json";
        }
    } catch {
        // Not JSON
    }
    return "text/plain";
}

function makeResponse(body: BodyInit | null, status: number = 200, contentType?: string): Response {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (contentType) {
        headers["Content-Type"] = contentType;
    }
    return new Response(body, { status, headers });
}

export function createHandler(mgr: QueueManager<string>, apiToken: string, rateLimitRequests?: number) {
    const rateLimiter = new RateLimiter(rateLimitRequests ?? 100);

    const innerHandler = async function(request: Request, remoteAddr?: string): Promise<Response> {
        // Check rate limit first (before auth)
        if (!rateLimiter.isAllowed(request, remoteAddr)) {
            return makeResponse("Too many requests", 429);
        }

        const url = request.url;

        if (healthPattern.exec(url)) {
            if (request.method !== "GET") {
                return makeResponse("Method not allowed", 405);
            }
            return makeResponse(JSON.stringify({ status: "ok" }), 200, "application/json");
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
            return makeResponse("Unauthorized", 401);
        }

        const isEnqueue = enqueuePattern.exec(url);
        const isDequeue = dequeuePattern.exec(url);
        const isPeek = peekPattern.exec(url);
        const isLength = lengthPattern.exec(url);
        const isQueues = queuesPattern.exec(url);

        if (isQueues) {
            if (request.method !== "GET") {
                return makeResponse("Method not allowed", 405);
            }
            const queueNames = mgr.listQueues();
            return makeResponse(JSON.stringify(queueNames), 200, "application/json");
        }

        if (isEnqueue) {
            if (request.method !== "POST") {
                return makeResponse("Method not allowed", 405);
            }

            const queueName = isEnqueue.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return makeResponse("Queue name too long", 400);
            }

            if (!mgr.canEnqueue(queueName)) {
                return makeResponse("Queue full or too many queues", 507);
            }

            const contentLength = request.headers.get("content-length");
            if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
                return makeResponse("Payload too large", 413);
            }
            try {
                const json = JSON.parse(await request.text());
                mgr.enqueue(queueName, json.payload);
                return makeResponse(`Payload successfully queued onto ${queueName}.`, 200, "text/plain");
            } catch {
                return makeResponse("Invalid JSON", 400);
            }
        }

        if (isDequeue) {
            if (request.method !== "GET") {
                return makeResponse("Method not allowed", 405);
            }

            const queueName = isDequeue.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return makeResponse("Queue name too long", 400);
            }

            const item = mgr.dequeue(queueName);
            if (item === undefined) {
                return makeResponse(null, 204);
            }
            return makeResponse(item, 200, detectContentType(item));
        }

        if (isPeek) {
            if (request.method !== "GET") {
                return makeResponse("Method not allowed", 405);
            }

            const queueName = isPeek.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return makeResponse("Queue name too long", 400);
            }

            const item = mgr.peek(queueName);
            if (item === undefined) {
                return makeResponse(null, 204);
            }
            return makeResponse(item, 200, detectContentType(item));
        }

        if (isLength) {
            if (request.method !== "GET") {
                return makeResponse("Method not allowed", 405);
            }

            const queueName = isLength.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return makeResponse("Queue name too long", 400);
            }

            const len = mgr.length(queueName);
            return makeResponse(`${len}`, 200, "text/plain");
        }

        return makeResponse("Not found.", 404);
    };

    return async function handler(request: Request, info?: Deno.ServeHandlerInfo): Promise<Response> {
        const start = performance.now();
        try {
            const remoteAddr = info?.remoteAddr && info.remoteAddr.transport === "tcp"
                ? info.remoteAddr.hostname
                : undefined;
            const response = await innerHandler(request, remoteAddr);
            const duration = performance.now() - start;
            console.log(`${request.method} ${request.url} ${response.status} ${duration.toFixed(2)}ms`);
            return response;
        } catch (error) {
            const duration = performance.now() - start;
            console.error(`${request.method} ${request.url} 500 ${duration.toFixed(2)}ms`);
            throw error;
        }
    };
}
