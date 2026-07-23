import * as Persistency from "./src/persist.ts";
import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";
import { parseConfig } from "./src/config.ts";

const LOG_ENCODER = new TextEncoder();

function writeLog(message: string): void {
    Deno.stdout.writeSync(LOG_ENCODER.encode(`${message}\n`));
}

const CONFIG = parseConfig(Deno.env.toObject(), Deno.args);

// Set up our persistency manager
const PERSIST_ENGINE = CONFIG.persistEnabled
    ? new Persistency.FileStore
    : new Persistency.MemoryStore;

PERSIST_ENGINE.dir(CONFIG.persistDir);

// Set up the manager, which will handle our queues for us
const MANAGER = new QueueManager(PERSIST_ENGINE, CONFIG.queueDepthLimit, CONFIG.queueCountLimit);

// Load up any existing queue data, if we're persisting
if (PERSIST_ENGINE instanceof Persistency.FileStore) {
    writeLog("Loading in data from persist.dat...\n");

    MANAGER.load();
}

const HANDLER = createHandler(MANAGER, CONFIG.apiToken, CONFIG.rateLimitRequests);

// Start up the application
const SERVER = Deno.serve({
    hostname: CONFIG.host,
    port: CONFIG.port,
    onListen: ({ hostname, port }) => writeLog(`Listening on ${hostname}:${port}`),
}, HANDLER);

async function shutdown(signal: string): Promise<void> {
    writeLog(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    await SERVER.shutdown();

    // If we're using file persistency, save all current state to persistant storage
    if (PERSIST_ENGINE instanceof Persistency.FileStore) {
        writeLog("Flushing data to persist.dat...\n");
        MANAGER.save();
    }

    writeLog("Goodbye!");

    Deno.exit(0);
}

Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
