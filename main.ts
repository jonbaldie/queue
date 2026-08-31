import * as Persistency from "./src/persist.ts";
import QueueManager from "./src/manager.ts";
import { createHandler } from "./src/handler.ts";
import { parseConfig } from "./src/config.ts";

const LOG_ENCODER = new TextEncoder();

function writeLog(message: string): void {
    Deno.stdout.writeSync(LOG_ENCODER.encode(`${message}\n`));
}

// Read each config var by name rather than Deno.env.toObject(), which
// enumerates the entire process environment and therefore requires
// unrestricted env access. A compiled binary with a scoped --allow-env
// allowlist (see Dockerfile/CI) can only grant per-name access.
const ENV_VAR_NAMES = [
    "HOST",
    "PORT",
    "PERSIST",
    "QUEUE_API_TOKEN",
    "QUEUE_DEPTH_LIMIT",
    "QUEUE_COUNT_LIMIT",
    "RATE_LIMIT_REQUESTS",
] as const;

function readEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    for (const name of ENV_VAR_NAMES) {
        env[name] = Deno.env.get(name);
    }
    return env;
}

const CONFIG = parseConfig(readEnv(), Deno.args);

// Set up our persistency manager
const PERSIST_ENGINE = CONFIG.persistEnabled
    ? new Persistency.FileStore
    : new Persistency.MemoryStore;

PERSIST_ENGINE.dir(CONFIG.persistDir);

// Set up the manager, which will handle our queues for us
const MANAGER = new QueueManager(PERSIST_ENGINE, CONFIG.queueDepthLimit, CONFIG.queueCountLimit, CONFIG.persistEnabled);

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

    PERSIST_ENGINE.close();

    writeLog("Goodbye!");

    Deno.exit(0);
}

Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
