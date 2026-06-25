import * as Persistency from "./src/persist.ts";
import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";
import { parseConfig } from "./src/config.ts";

const config = parseConfig(Deno.env.toObject(), Deno.args);

// Set up our persistency manager
const persist = config.persistEnabled
    ? new Persistency.FileStore
    : new Persistency.MemoryStore;

persist.dir(config.persistDir);

// Set up the manager, which will handle our queues for us
const mgr = new QueueManager(persist, config.queueDepthLimit, config.queueCountLimit);

// Load up any existing queue data, if we're persisting
if (persist instanceof Persistency.FileStore) {
    console.log("Loading in data from persist.dat...\n");

    mgr.load();
}

const handler = createHandler(mgr, config.apiToken, config.rateLimitRequests);

// Start up the application
const server = Deno.serve({ hostname: config.host, port: config.port, onListen: ({ hostname, port }) => console.log(`Listening on ${hostname}:${port}`) }, handler);

const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    await server.shutdown();

    // If we're using file persistency, save all current state to persistant storage
    if (persist instanceof Persistency.FileStore) {
        console.log("Flushing data to persist.dat...\n");
        mgr.save();
    }

    console.log("Goodbye!");

    Deno.exit(0);
};

Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
