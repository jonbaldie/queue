import { parseArgs } from "jsr:@std/cli/parse-args";
import * as Persistency from "./src/persist.ts";
import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";

// Environment variables
const HOST = Deno.env.get("HOST") || "localhost";
const PORT = Deno.env.get("PORT") || 3000;
const PERSIST = Deno.env.get("PERSIST") || Deno.cwd();
const QUEUE_API_TOKEN = Deno.env.get("QUEUE_API_TOKEN") || "";

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
const mgr = new QueueManager(persist);

// Load up any existing queue data, if we're persisting
if (persist instanceof Persistency.File) {
    console.log("Loading in data from persist.dat...\n");

    mgr.load();
}

const handler = createHandler(mgr, QUEUE_API_TOKEN);

// Start up the application
Deno.serve({ hostname: HOST, port: Number(PORT), onListen: ({ hostname, port }) => console.log(`Listening on ${hostname}:${port}`) }, handler);

