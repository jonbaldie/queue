import QueueManager from "./manager.ts";

const enqueue = new URLPattern({ pathname: "/enqueue/:queue" });
const dequeue = new URLPattern({ pathname: "/dequeue/:queue" });
const length = new URLPattern({ pathname: "/length/:queue" });

export function createHandler(mgr: QueueManager<any>, apiToken: string) {
    return async function handler(request: Request): Promise<Response> {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
            return new Response("Unauthorized", { status: 401 });
        }

        const is_enqueue = enqueue.exec(request.url);
        const is_dequeue = dequeue.exec(request.url);
        const is_length = length.exec(request.url);

        if (is_enqueue && request.method === "POST") {
            const json = JSON.parse(await request.text());

            mgr.enqueue(is_enqueue.pathname.groups.queue!, json.payload);

            return new Response(`Payload successfully queued onto ${is_enqueue.pathname.groups.queue}.`);
        }

        if (is_dequeue) {
            let item = mgr.dequeue(is_dequeue.pathname.groups.queue!);

            return new Response(item);
        }

        if (is_length) {
            let len = mgr.length(is_length.pathname.groups.queue!);

            return new Response(`${len}`);
        }

        return new Response("Not found.", { status: 404 });
    };
}
