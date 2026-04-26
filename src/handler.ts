import QueueManager from "./manager.ts";

const enqueuePattern = /^\/enqueue\/(.+)$/;
const dequeuePattern = /^\/dequeue\/(.+)$/;
const lengthPattern = /^\/length\/(.+)$/;

export function createHandler(mgr: QueueManager<any>, apiToken: string) {
    return async function handler(request: Request): Promise<Response> {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
            return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const pathname = url.pathname;

        const enqueueMatch = pathname.match(enqueuePattern);
        const dequeueMatch = pathname.match(dequeuePattern);
        const lengthMatch = pathname.match(lengthPattern);

        try {
            if (enqueueMatch && request.method === "POST") {
                const queue = enqueueMatch[1];
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
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error handling request: ${message}`);
            return new Response("Internal Server Error", { status: 500 });
        }
    };
}
