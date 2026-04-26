import QueueManager from "./manager.ts";

const enqueuePattern = /^\/enqueue\/(.+)$/;
const dequeuePattern = /^\/dequeue\/(.+)$/;
const lengthPattern = /^\/length\/(.+)$/;

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

        const url = new URL(request.url);
        const pathname = url.pathname;

        const enqueueMatch = pathname.match(enqueuePattern);
        const dequeueMatch = pathname.match(dequeuePattern);
        const lengthMatch = pathname.match(lengthPattern);

        if (enqueueMatch && request.method === "POST") {
            const queue = enqueueMatch[1];

            // Check if we can enqueue
            if (!mgr.canEnqueue(queue)) {
                return new Response("Queue full or too many queues", { status: 507 });
            }

            const json = JSON.parse(await request.text());

            mgr.enqueue(queue, json.payload);

            return new Response(`Payload successfully queued onto ${queue}.`);
        }

        if (dequeueMatch) {
            const queue = dequeueMatch[1];
            let item = mgr.dequeue(queue);

            return new Response(item);
        }

        if (lengthMatch) {
            const queue = lengthMatch[1];
            let len = mgr.length(queue);

            return new Response(`${len}`);
        }

        return new Response("Not found.", { status: 404 });
    };
}
