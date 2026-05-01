import { parseArgs } from "jsr:@std/cli@1.0/parse-args";
import * as Persistency from "./src/persist.ts";
import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";

// Environment variables
const HOST = Deno.env.get("HOST") || "localhost";
const PORT = Deno.env.get("PORT") || 3000;
const PERSIST = Deno.env.get("PERSIST") || Deno.cwd();
const QUEUE_API_TOKEN = Deno.env.get("QUEUE_API_TOKEN") || "";
const QUEUE_DEPTH_LIMIT = Deno.env.get("QUEUE_DEPTH_LIMIT") ? parseInt(Deno.env.get("QUEUE_DEPTH_LIMIT")!) : 10000;
const QUEUE_COUNT_LIMIT = Deno.env.get("QUEUE_COUNT_LIMIT") ? parseInt(Deno.env.get("QUEUE_COUNT_LIMIT")!) : 1000;
const RATE_LIMIT_REQUESTS = Deno.env.get("RATE_LIMIT_REQUESTS") ? parseInt(Deno.env.get("RATE_LIMIT_REQUESTS")!) : 100;

// Persistency of queue data is opt-in with the --persist flag
const flags = parseArgs(Deno.args, {
    boolean: ["persist"],
    default: { persist: false },
});

// Set up our persistency manager
const persist = flags.persist
    ? new Persistency.File
    : new Persistency.None;

persist.dir(PERSIST);

// Set up the manager, which will handle our queues for us
const mgr = new QueueManager(persist, QUEUE_DEPTH_LIMIT, QUEUE_COUNT_LIMIT);

// Load up any existing queue data, if we're persisting
if (persist instanceof Persistency.File) {
    console.log("Loading in data from persist.dat...\n");

    mgr.load();
}

const handler = createHandler(mgr, QUEUE_API_TOKEN, RATE_LIMIT_REQUESTS);

// Start up the application
const server = Deno.serve({ hostname: HOST, port: Number(PORT), onListen: ({ hostname, port }) => console.log(`Listening on ${hostname}:${port}`) }, handler);

const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    await server.shutdown();

    // If we're using file persistency, save all current state to persistant storage
    if (persist instanceof Persistency.File) {
        console.log("Flushing data to persist.dat...\n");
        mgr.save();
    }

    console.log("Goodbye!");

    Deno.exit(0);
};

Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
