import { parseArgs } from "jsr:@std/cli@1.0/parse-args";

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

export interface Config {
    host: string;
    port: number;
    persistDir: string;
    apiToken: string;
    queueDepthLimit: number;
    queueCountLimit: number;
    rateLimitRequests: number;
    persistEnabled: boolean;
}

export function parseConfig(env: Record<string, string | undefined>, args: string[]): Config {
    const flags = parseArgs(args, {
        boolean: ["persist"],
        default: { persist: false },
    });

    let port = 3000;
    if (env["PORT"]) {
        const p = parseInt(env["PORT"], 10);
        if (isNaN(p) || p < 0 || p > 65535) {
            throw new ConfigError("PORT must be a valid integer between 0 and 65535");
        }
        port = p;
    }

    const parsePositiveInt = (name: string, value: string | undefined, defaultValue: number): number => {
        if (!value) return defaultValue;
        const num = parseInt(value, 10);
        if (isNaN(num) || num <= 0) {
            throw new ConfigError(`${name} must be a positive integer`);
        }
        return num;
    };

    const queueDepthLimit = parsePositiveInt("QUEUE_DEPTH_LIMIT", env["QUEUE_DEPTH_LIMIT"], 10000);
    const queueCountLimit = parsePositiveInt("QUEUE_COUNT_LIMIT", env["QUEUE_COUNT_LIMIT"], 1000);
    const rateLimitRequests = parsePositiveInt("RATE_LIMIT_REQUESTS", env["RATE_LIMIT_REQUESTS"], 100);

    return {
        host: env["HOST"] || "localhost",
        port,
        persistDir: env["PERSIST"] || Deno.cwd(),
        apiToken: env["QUEUE_API_TOKEN"] || "",
        queueDepthLimit,
        queueCountLimit,
        rateLimitRequests,
        persistEnabled: flags.persist,
    };
}
