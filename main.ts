import { parse } from "https://deno.land/std@0.119.0/flags/mod.ts";
import * as Persistency from "./src/persist.ts";
import Queue from "./src/queue.ts";
import QueueManager from "./src/manager.ts";
import { serve } from "https://deno.land/std@0.114.0/http/server.ts";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const MAX_QUEUE_NAME_LENGTH = 128;

// Environment variables
const HOST = Deno.env.get("HOST") || "localhost";
const PORT = Deno.env.get("PORT") || 3000;
const PERSIST = Deno.env.get("PERSIST") || Deno.cwd();

// Persistency of queue data is opt-in with the --persist flag
const flags = parse(Deno.args, {
    boolean: ["persist"],
    default: { persist: false },
});

// Set up our persistency manager
const persist = flags.persist
    ? new Persistency.File
    : new Persistency.None;

persist.dir(PERSIST);

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
export async function handler(request: Request): Promise<Response> {
    const is_enqueue = enqueue.exec(request.url);
    const is_dequeue = dequeue.exec(request.url);
    const is_length = length.exec(request.url);

    if (is_enqueue) {
        // Fix 3: Enforce HTTP method on routes — POST for enqueue only
        if (request.method !== "POST") {
            return new Response("Method not allowed", { status: 405 });
        }

        // Fix 4: Validate queue name length
        const queueName = is_enqueue.pathname.groups.queue as string;
        if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
            return new Response("Queue name too long", { status: 400 });
        }

        // Fix 2: Reject requests where Content-Length exceeds max
        const contentLength = request.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
            return new Response("Payload too large", { status: 413 });
        }

        // Fix 1: Wrap JSON.parse in try/catch
        try {
            const json = JSON.parse(await request.text());
            mgr.enqueue(queueName, json.payload);
            return new Response(`Payload successfully queued onto ${queueName}.`);
        } catch {
            return new Response("Invalid JSON", { status: 400 });
        }
    }

    if (is_dequeue) {
        // Fix 3: Enforce HTTP method on routes — GET-only for dequeue
        if (request.method !== "GET") {
            return new Response("Method not allowed", { status: 405 });
        }

        // Fix 4: Validate queue name length
        const queueName = is_dequeue.pathname.groups.queue as string;
        if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
            return new Response("Queue name too long", { status: 400 });
        }

        let item = mgr.dequeue(queueName);

        return new Response(item);
    }

    if (is_length) {
        // Fix 3: Enforce HTTP method on routes — GET-only for length
        if (request.method !== "GET") {
            return new Response("Method not allowed", { status: 405 });
        }

        // Fix 4: Validate queue name length
        const queueName = is_length.pathname.groups.queue as string;
        if (queueName.length > MAX_QUEUE_NAME_LENGTH) {
            return new Response("Queue name too long", { status: 400 });
        }

        let len = mgr.length(queueName);

        return new Response(`${len}`);
    }

    return new Response("Not found.", { status: 404 });
}

if (import.meta.main) {
    console.log(`Listening on ${HOST}:${PORT}`);

    // Start up the application
    serve(handler, { addr: `${HOST}:${PORT}` });
}

