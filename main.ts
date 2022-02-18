import Queue from "./src/queue.ts"
import QueueManager from "./src/manager.ts"
import { serve } from "https://deno.land/std@0.114.0/http/server.ts";

// Set up the manager, which will handle our queues for us
const mgr = new QueueManager;

// Set up our routes, defining how users will interact with us
const enqueue = new URLPattern({ pathname: "/enqueue/:queue" });
const dequeue = new URLPattern({ pathname: "/dequeue/:queue" });

// This function controls how the application responds to requests
async function handler(request: Request)/*: Response*/ {
    const is_enqueue = enqueue.exec(request.url);
    const is_dequeue = dequeue.exec(request.url);

    if (is_enqueue && request.method === "POST") {
        const json = JSON.parse(await request.text());

        mgr.enqueue(is_enqueue.pathname.groups.queue, json.payload);

        return new Response(`Payload successfully queued onto ${is_enqueue.pathname.groups.queue}.`);
    }

    if (is_dequeue) {
        let item = mgr.dequeue(is_dequeue.pathname.groups.queue);

        return new Response(item);
    }

    return new Response("Not found.", { status: 404 });
}

// Start up the application
serve(handler, { addr: "localhost:3000" });

/*
mgr.enqueue("foo", "php /var/www/html/index.php");

console.log(mgr);
console.log(mgr.dequeue("foo"));
*/
