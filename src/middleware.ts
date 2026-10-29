import { RateLimiter } from "./rate_limiter.ts";

export type HttpHandler = (request: Request, info?: Deno.ServeHandlerInfo) => Promise<Response> | Response;
export type Middleware = (next: HttpHandler) => HttpHandler;

const HEALTH_PATTERN = new URLPattern({ pathname: "/health{/}?" });
const LOG_ENCODER = new TextEncoder();

export interface LogSink {
    write(message: string, isError?: boolean): void;
}

export const DEFAULT_CONSOLE_SINK: LogSink = {
    write(message: string, isError = false): void {
        const destination = isError ? Deno.stderr : Deno.stdout;
        destination.writeSync(LOG_ENCODER.encode(`${message}\n`));
    },
};

export function withLogging(sink: LogSink = DEFAULT_CONSOLE_SINK) {
    return (next: HttpHandler) => async (request: Request, info?: Deno.ServeHandlerInfo): Promise<Response> => {
        const start = performance.now();
        try {
            const response = await next(request, info);
            const duration = performance.now() - start;
            sink.write(
                `${request.method} ${request.url} ${response.status} ${duration.toFixed(2)}ms`,
                false,
            );
            return response;
        } catch (error) {
            const duration = performance.now() - start;
            sink.write(
                `${request.method} ${request.url} 500 ${duration.toFixed(2)}ms`,
                true,
            );
            throw error;
        }
    };
}

export function withAuth(apiToken: string): Middleware {
    const trimmedToken = apiToken?.trim();
    return (next: HttpHandler) => {
        return (request: Request, info?: Deno.ServeHandlerInfo) => {
            if (HEALTH_PATTERN.exec(request.url)) {
                return next(request, info);
            }
            const authHeader = request.headers.get("Authorization");
            const [scheme, ...rest] = (authHeader ?? "").trim().split(/\s+/);
            const token = rest.join(" ");
            if (!trimmedToken || !scheme || scheme.toLowerCase() !== "bearer" || !token || token !== trimmedToken) {
                return new Response("Unauthorized", {
                    status: 401,
                    headers: { "WWW-Authenticate": "Bearer" },
                });
            }
            return next(request, info);
        };
    };
}


export function extractClientIdentifier(request: Request, info?: Deno.ServeHandlerInfo): string {
    const remoteAddr = info?.remoteAddr && info.remoteAddr.transport === "tcp"
        ? info.remoteAddr.hostname
        : undefined;
    if (remoteAddr) return remoteAddr;
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) return forwardedFor.split(",")[0].trim();
    return "unknown";
}

export function withRateLimit(limiter: RateLimiter): Middleware {
    return (next: HttpHandler) => {
        return (request: Request, info?: Deno.ServeHandlerInfo) => {
            if (HEALTH_PATTERN.exec(request.url)) {
                return next(request, info);
            }
            if (!limiter.isAllowed(extractClientIdentifier(request, info))) {
                return new Response("Too many requests", { status: 429 });
            }
            return next(request, info);
        };
    };
}
