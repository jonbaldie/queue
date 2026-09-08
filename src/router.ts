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

    public handle: HttpHandler = async (request: Request): Promise<Response> => {
        const url = request.url;
        let matchedPattern = false;
        const allowedMethods: string[] = [];

        for (const route of this.routes) {
            const match = route.pattern.exec(url);
            if (!match) {
                continue;
            }

            matchedPattern = true;
            if (!allowedMethods.includes(route.method)) {
                allowedMethods.push(route.method);
            }

            if (request.method === "HEAD" && route.method === "GET") {
                const getResponse = await route.handler(request, match);
                return new Response(null, {
                    status: getResponse.status,
                    statusText: getResponse.statusText,
                    headers: getResponse.headers,
                });
            }

            if (request.method === route.method) {
                return route.handler(request, match);
            }
        }

        if (matchedPattern) {
            return new Response("Method not allowed", {
                status: 405,
                headers: { "Allow": allowedMethods.join(", ") },
            });
        }

        return new Response("Not found.", { status: 404 });
    };
}
