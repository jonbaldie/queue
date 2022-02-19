import { parse } from "https://deno.land/std@0.119.0/flags/mod.ts";
import * as Persistency from "./src/persist.ts";
import Queue from "./src/queue.ts";
import QueueManager from "./src/manager.ts";
import { serve } from "https://deno.land/std@0.114.0/http/server.ts";

// Persistency of queue data is opt-in with the --persist flag
const flags = parse(Deno.args, {
    boolean: ["persist"],
    default: { persist: false },
});

// Set up our persistency manager
const persist = flags.persist
    ? new Persistency.File
    : new Persistency.None;

// Set up the manager, which will handle our queues for us
const mgr = new QueueManager(persist);

// Load up any existing queue data, if we're persisting
if (persist instanceof Persistency.File) {
    console.log("Loading in data from persist.dat...\n");

    mgr.load();
}

// Set up our routes, defining how users will interact with us
const enqueue = new URLPattern({ pathname: "/enqueue/:queue" });
const dequeue = new URLPattern({ pathname: "/dequeue/:queue" });
const length = new URLPattern({ pathname: "/length/:queue" });

// This function controls how the application responds to requests
async function handler(request: Request): Promise<Response> {
    const is_enqueue = enqueue.exec(request.url);
    const is_dequeue = dequeue.exec(request.url);
    const is_length = length.exec(request.url);

    if (is_enqueue && request.method === "POST") {
        const json = JSON.parse(await request.text());

        mgr.enqueue(is_enqueue.pathname.groups.queue, json.payload);

        return new Response(`Payload successfully queued onto ${is_enqueue.pathname.groups.queue}.`);
    }

    if (is_dequeue) {
        let item = mgr.dequeue(is_dequeue.pathname.groups.queue);

        return new Response(item);
    }

    if (is_length) {
        let length = mgr.length(is_length.pathname.groups.queue);

        return new Response(`${length}`);
    }

    return new Response("Not found.", { status: 404 });
}

console.log(`Listening on localhost:3000`);

// Start up the application
serve(handler, { addr: "localhost:3000" });

