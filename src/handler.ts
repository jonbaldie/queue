import QueueManager from "./manager.ts";
import { RateLimiter } from "./rate_limiter.ts";
import { withAuth, withRateLimit } from "./middleware.ts";
import { Router } from "./router.ts";
import * as Payload from "./payload.ts";
import * as QueueName from "./queue_name.ts";

type JsonPayload = Payload.Payload;
type RouteHandler = Parameters<Router["get"]>[1];
type QueueRouteHandler = (queueName: string, request: Request) => Response | Promise<Response>;

const LOG_ENCODER = Reflect.construct(TextEncoder, []);

function queueNameErrorResponse(error: unknown): Response {
    if (error instanceof QueueName.InvalidQueueNameError) {
        return new Response("Invalid queue name", { status: 400 });
    }
    if (error instanceof QueueName.QueueNameTooLongError) {
        return new Response("Queue name too long", { status: 400 });
    }
    throw error;
}

function queueRoute(
    handle: QueueRouteHandler,
    parseName: (raw: string | undefined) => string = QueueName.parseQueueName,
): RouteHandler {
    return async (request, match) => {
        try {
            return await handle(parseName(match.pathname.groups.queue), request);
        } catch (error) {
            return queueNameErrorResponse(error);
        }
    };
}

function enqueueHandler(mgr: QueueManager<JsonPayload>): QueueRouteHandler {
    return async (queueName, request) => {
        try {
            const contentLength = request.headers.get("content-length");
            if (contentLength && parseInt(contentLength) > Payload.DEFAULT_MAX_PAYLOAD_SIZE) {
                return new Response("Payload too large", { status: 413 });
            }
            const payload = await Payload.readAndValidatePayload(
                request.body,
                Payload.DEFAULT_MAX_PAYLOAD_SIZE,
            );
            if (!mgr.canEnqueue(queueName)) {
                return new Response("Queue full or too many queues", { status: 507 });
            }
            mgr.enqueue(queueName, payload);
            return new Response(`Payload successfully queued onto ${queueName}.`);
        } catch (error) {
            return enqueueErrorResponse(error);
        }
    };
}

function enqueueErrorResponse(error: unknown): Response {
    if (error instanceof Payload.PayloadTooLargeError) {
        return new Response(error.message, { status: 413 });
    }
    if (error instanceof Payload.UnsupportedNumberError) {
        return new Response(error.message, { status: 400 });
    }
    if (error instanceof Payload.JsonNestingTooDeepError) {
        return new Response("Invalid JSON", { status: 400 });
    }
    if (error instanceof Payload.InvalidPayloadError) {
        return new Response(error.message, { status: 400 });
    }
    throw error;
}

function itemResponse(item: JsonPayload | undefined): Response {
    if (item === undefined) {
        return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(item), {
        headers: { "Content-Type": "application/json" },
    });
}

function dequeueHandler(mgr: QueueManager<JsonPayload>): QueueRouteHandler {
    return (queueName, request) => {
        const item = request.method === "HEAD" ? mgr.peek(queueName) : mgr.dequeue(queueName);
        return itemResponse(item);
    };
}

function peekHandler(mgr: QueueManager<JsonPayload>): QueueRouteHandler {
    return (queueName) => itemResponse(mgr.peek(queueName));
}

function lengthHandler(mgr: QueueManager<JsonPayload>): QueueRouteHandler {
    return (queueName) => new Response(`${mgr.length(queueName)}`);
}

function registerRoutes(router: Router, mgr: QueueManager<JsonPayload>): void {
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
    // Enqueue only decodes here; QueueManager applies the length rule after the
    // payload is validated, so payload errors keep precedence over it.
    router.post("/enqueue/:queue", queueRoute(enqueueHandler(mgr), QueueName.decodeQueueName));
    router.get("/dequeue/:queue", queueRoute(dequeueHandler(mgr)));
    router.get("/peek/:queue", queueRoute(peekHandler(mgr)));
    router.get("/length/:queue", queueRoute(lengthHandler(mgr)));
}

function writeLog(destination: { writeSync(data: Uint8Array): number }, message: string): void {
    destination.writeSync(LOG_ENCODER.encode(`${message}\n`));
}

export function createHandler(
    mgr: QueueManager<JsonPayload>,
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
