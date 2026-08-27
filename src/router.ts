import { HttpHandler } from "./middleware.ts";

export type RouteHandler = (request: Request, match: URLPatternResult) => Promise<Response> | Response;

interface Route {
    pattern: URLPattern;
    method: string;
    handler: RouteHandler;
}

export class Router {
    private routes: Route[] = [];

    public get(pathname: string, handler: RouteHandler): void {
        this.routes.push({
            pattern: new URLPattern({ pathname }),
            method: "GET",
            handler,
        });
    }

    public post(pathname: string, handler: RouteHandler): void {
        this.routes.push({
            pattern: new URLPattern({ pathname }),
            method: "POST",
            handler,
        });
    }

    public handle: HttpHandler = (request: Request): Promise<Response> | Response => {
        const url = request.url;
        for (const route of this.routes) {
            const match = route.pattern.exec(url);
            if (match) {
                if (request.method !== route.method) {
                    return new Response("Method not allowed", { status: 405 });
                }
                return route.handler(request, match);
            }
        }
        return new Response("Not found.", { status: 404 });
    };
}
