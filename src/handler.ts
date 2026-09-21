import QueueManager, { QueueNameTooLongError } from "./manager.ts";
import { RateLimiter } from "./rate_limiter.ts";
import { HttpHandler, withAuth, withRateLimit } from "./middleware.ts";
import { RouteHandler, Router } from "./router.ts";
import { readJsonBody } from "./request_body.ts";

const LOG_ENCODER = new TextEncoder();

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
        const body = await readJsonBody(request);
        if (body instanceof Response) {
            return body;
        }
        const json = body.json;
        try {
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
            return queueNameErrorResponse(error);
        }
    };
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
): (...args: Parameters<HttpHandler>) => Promise<Response> {
    const rateLimiter = new RateLimiter(rateLimitRequests ?? 100);
    const router = new Router();
    registerRoutes(router, mgr);
    const handlerWithAuth = withAuth(apiToken)(router.handle);
    const handlerWithRateLimit = withRateLimit(rateLimiter)(handlerWithAuth);

    return async function handler(request, info) {
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
