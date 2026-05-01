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

function isJson(value: string): boolean {
    try {
        const parsed = JSON.parse(value);
        return parsed !== null && typeof parsed === "object";
    } catch {
        return false;
    }
}

function createResponse(body: BodyInit | null, status: number, extraHeaders?: Record<string, string>): Response {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (extraHeaders) {
        Object.assign(headers, extraHeaders);
    }
    return new Response(body, { status, headers });
}

export function createHandler(mgr: QueueManager<string>, apiToken: string, rateLimitRequests?: number) {
    const rateLimiter = new RateLimiter(rateLimitRequests ?? 100);

    const innerHandler = async function(request: Request, remoteAddr?: string): Promise<Response> {
        // Check rate limit first (before auth)
        if (!rateLimiter.isAllowed(request, remoteAddr)) {
            return createResponse("Too many requests", 429);
        }

        const url = request.url;

        if (healthPattern.exec(url)) {
            if (request.method !== "GET") {
                return createResponse("Method not allowed", 405);
            }
            return createResponse(JSON.stringify({ status: "ok" }), 200, { "Content-Type": "application/json" });
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
            return createResponse("Unauthorized", 401);
        }

        const isEnqueue = enqueuePattern.exec(url);
        const isDequeue = dequeuePattern.exec(url);
        const isPeek = peekPattern.exec(url);
        const isLength = lengthPattern.exec(url);
        const isQueues = queuesPattern.exec(url);

        if (isQueues) {
            if (request.method !== "GET") {
                return createResponse("Method not allowed", 405);
            }
            const queueNames = mgr.listQueues();
            return createResponse(JSON.stringify(queueNames), 200, { "Content-Type": "application/json" });
        }

        if (isEnqueue) {
            if (request.method !== "POST") {
                return createResponse("Method not allowed", 405);
            }

            const queueName = isEnqueue.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return createResponse("Queue name too long", 400);
            }

            if (!mgr.canEnqueue(queueName)) {
                return createResponse("Queue full or too many queues", 507);
            }

            const contentLength = request.headers.get("content-length");
            if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
                return createResponse("Payload too large", 413);
            }
            try {
                const json = JSON.parse(await request.text());
                mgr.enqueue(queueName, json.payload);
                return createResponse(`Payload successfully queued onto ${queueName}.`, 200, { "Content-Type": "text/plain" });
            } catch {
                return createResponse("Invalid JSON", 400);
            }
        }

        if (isDequeue) {
            if (request.method !== "GET") {
                return createResponse("Method not allowed", 405);
            }

            const queueName = isDequeue.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return createResponse("Queue name too long", 400);
            }

            const item = mgr.dequeue(queueName);
            if (item === undefined) {
                return createResponse(null, 204);
            }
            const contentType = isJson(item) ? "application/json" : "text/plain";
            return createResponse(item, 200, { "Content-Type": contentType });
        }

        if (isPeek) {
            if (request.method !== "GET") {
                return createResponse("Method not allowed", 405);
            }

            const queueName = isPeek.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return createResponse("Queue name too long", 400);
            }

            const item = mgr.peek(queueName);
            if (item === undefined) {
                return createResponse(null, 204);
            }
            const contentType = isJson(item) ? "application/json" : "text/plain";
            return createResponse(item, 200, { "Content-Type": contentType });
        }

        if (isLength) {
            if (request.method !== "GET") {
                return createResponse("Method not allowed", 405);
            }

            const queueName = isLength.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return createResponse("Queue name too long", 400);
            }

            const len = mgr.length(queueName);
            return createResponse(`${len}`, 200, { "Content-Type": "text/plain" });
        }

        return createResponse("Not found.", 404);
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
