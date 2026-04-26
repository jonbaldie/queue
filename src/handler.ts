import QueueManager from "./manager.ts";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const MAX_QUEUE_NAME_LENGTH = 128;

const enqueuePattern = new URLPattern({ pathname: "/enqueue/:queue" });
const dequeuePattern = new URLPattern({ pathname: "/dequeue/:queue" });
const lengthPattern = new URLPattern({ pathname: "/length/:queue" });

class RateLimiter {
    private requestTimestamps: Map<string, number[]> = new Map();
    private requestsPerMinute: number;

    constructor(requestsPerMinute: number = 100) {
        this.requestsPerMinute = requestsPerMinute;
    }

    private getClientIp(request: Request): string {
        // Check for x-forwarded-for header first (proxy/CDN)
        const forwardedFor = request.headers.get("x-forwarded-for");
        if (forwardedFor) {
            return forwardedFor.split(",")[0].trim();
        }
        // Fall back to trying to get from request (may not be available in all environments)
        return "unknown";
    }

    public isAllowed(request: Request): boolean {
        const ip = this.getClientIp(request);
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Get or create timestamp list for this IP
        let timestamps = this.requestTimestamps.get(ip) || [];

        // Remove timestamps older than 1 minute
        timestamps = timestamps.filter(ts => ts > oneMinuteAgo);

        // Check if we've exceeded the limit
        if (timestamps.length >= this.requestsPerMinute) {
            return false;
        }

        // Add current timestamp and save
        timestamps.push(now);
        this.requestTimestamps.set(ip, timestamps);

        return true;
    }
}

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
