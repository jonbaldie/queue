import { RateLimiter } from "./rate_limiter.ts";

export type HttpHandler = (request: Request, info?: Deno.ServeHandlerInfo) => Promise<Response> | Response;
export type Middleware = (next: HttpHandler) => HttpHandler;

const HEALTH_PATTERN = new URLPattern({ pathname: "/health{/}?" });

export function withAuth(apiToken: string): Middleware {
    return (next: HttpHandler) => {
        return (request: Request, info?: Deno.ServeHandlerInfo) => {
            if (HEALTH_PATTERN.exec(request.url)) {
                return next(request, info);
            }
            const authHeader = request.headers.get("Authorization");
            if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
                return new Response("Unauthorized", { status: 401 });
            }
            return next(request, info);
        };
    };
}

export function withRateLimit(limiter: RateLimiter): Middleware {
    return (next: HttpHandler) => {
        return (request: Request, info?: Deno.ServeHandlerInfo) => {
            if (HEALTH_PATTERN.exec(request.url)) {
                return next(request, info);
            }
            const remoteAddr = info?.remoteAddr && info.remoteAddr.transport === "tcp"
                ? info.remoteAddr.hostname
                : undefined;

            if (!limiter.isAllowed(request, remoteAddr)) {
                return new Response("Too many requests", { status: 429 });
            }
            return next(request, info);
        };
    };
}
