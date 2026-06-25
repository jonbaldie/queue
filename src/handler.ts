import QueueManager, { QueueNameTooLongError } from "./manager.ts";
import { RateLimiter } from "./rate_limiter.ts";
import { withAuth, withRateLimit } from "./middleware.ts";
import { Router } from "./router.ts";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

export function createHandler(mgr: QueueManager<string>, apiToken: string, rateLimitRequests?: number) {
    const rateLimiter = new RateLimiter(rateLimitRequests ?? 100);
    const router = new Router();

    router.get("/health", () => {
        return new Response(JSON.stringify({ status: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });

    router.get("/queues", () => {
        const queueNames = mgr.listQueues();
        return new Response(JSON.stringify(queueNames), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });

    router.post("/enqueue/:queue", async (request, match) => {
        const queueName = match.pathname.groups.queue as string;

        const contentLength = request.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
            return new Response("Payload too large", { status: 413 });
        }
        let body: string;
        try {
            body = await request.text();
        } catch {
            return new Response("Payload too large", { status: 413 });
        }
        if (body.length > MAX_BODY_SIZE) {
            return new Response("Payload too large", { status: 413 });
        }
        try {
            const json = JSON.parse(body);
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
        } catch (e) {
            if (e instanceof SyntaxError) {
                return new Response("Invalid JSON", { status: 400 });
            }
            if (e instanceof QueueNameTooLongError) {
                return new Response("Queue name too long", { status: 400 });
            }
            throw e;
        }
    });

    router.get("/dequeue/:queue", (_request, match) => {
        const queueName = match.pathname.groups.queue as string;
        try {
            const item = mgr.dequeue(queueName);
            if (item === undefined) {
                return new Response(null, { status: 204 });
            }
            if (typeof item === "object" && item !== null) {
                return new Response(JSON.stringify(item), {
                    headers: { "Content-Type": "application/json" },
                });
            }
            return new Response(item);
        } catch (e) {
            if (e instanceof QueueNameTooLongError) {
                return new Response("Queue name too long", { status: 400 });
            }
            throw e;
        }
    });

    router.get("/peek/:queue", (_request, match) => {
        const queueName = match.pathname.groups.queue as string;
        try {
            const item = mgr.peek(queueName);
            if (item === undefined) {
                return new Response(null, { status: 204 });
            }
            if (typeof item === "object" && item !== null) {
                return new Response(JSON.stringify(item), {
                    headers: { "Content-Type": "application/json" },
                });
            }
            return new Response(item);
        } catch (e) {
            if (e instanceof QueueNameTooLongError) {
                return new Response("Queue name too long", { status: 400 });
            }
            throw e;
        }
    });

    router.get("/length/:queue", (_request, match) => {
        const queueName = match.pathname.groups.queue as string;
        try {
            const len = mgr.length(queueName);
            return new Response(`${len}`);
        } catch (e) {
            if (e instanceof QueueNameTooLongError) {
                return new Response("Queue name too long", { status: 400 });
            }
            throw e;
        }
    });

    const handlerWithAuth = withAuth(apiToken)(router.handle);
    const handlerWithRateLimit = withRateLimit(rateLimiter)(handlerWithAuth);

    return async function handler(request: Request, info?: Deno.ServeHandlerInfo): Promise<Response> {
        const start = performance.now();
        try {
            const response = await handlerWithRateLimit(request, info);
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
