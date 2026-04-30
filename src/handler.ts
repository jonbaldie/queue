import QueueManager from "./manager.ts";
import { RateLimiter } from "./rate_limiter.ts";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const MAX_QUEUE_NAME_LENGTH = 128;

const enqueuePattern = new URLPattern({ pathname: "/enqueue/:queue" });
const dequeuePattern = new URLPattern({ pathname: "/dequeue/:queue" });
const lengthPattern = new URLPattern({ pathname: "/length/:queue" });

export function createHandler(mgr: QueueManager<any>, apiToken: string, rateLimitRequests?: number) {
    const rateLimiter = new RateLimiter(rateLimitRequests ?? 100);

    return async function handler(request: Request): Promise<Response> {
        // Check rate limit first (before auth)
        if (!rateLimiter.isAllowed(request)) {
            return new Response("Too many requests", { status: 429 });
        }

        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
            return new Response("Unauthorized", { status: 401 });
        }

        const url = request.url;
        const is_enqueue = enqueuePattern.exec(url);
        const is_dequeue = dequeuePattern.exec(url);
        const is_length = lengthPattern.exec(url);

        if (is_enqueue) {
            if (request.method !== "POST") {
                return new Response("Method not allowed", { status: 405 });
            }

            const queueName = is_enqueue.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return new Response("Queue name too long", { status: 400 });
            }

            if (!mgr.canEnqueue(queueName)) {
                return new Response("Queue full or too many queues", { status: 507 });
            }

            const contentLength = request.headers.get("content-length");
            if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
                return new Response("Payload too large", { status: 413 });
            }
            try {
                const json = JSON.parse(await request.text());
                mgr.enqueue(queueName, json.payload);
                return new Response(`Payload successfully queued onto ${queueName}.`);
            } catch {
                return new Response("Invalid JSON", { status: 400 });
            }
        }

        if (is_dequeue) {
            if (request.method !== "GET") {
                return new Response("Method not allowed", { status: 405 });
            }

            const queueName = is_dequeue.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return new Response("Queue name too long", { status: 400 });
            }

            let item = mgr.dequeue(queueName);
            if (item === undefined) {
                return new Response(null, { status: 204 });
            }
            return new Response(item);
        }

        if (is_length) {
            if (request.method !== "GET") {
                return new Response("Method not allowed", { status: 405 });
            }

            const queueName = is_length.pathname.groups.queue as string;
            if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
                return new Response("Queue name too long", { status: 400 });
            }

            let len = mgr.length(queueName);
            return new Response(`${len}`);
        }

        return new Response("Not found.", { status: 404 });
    };
}
