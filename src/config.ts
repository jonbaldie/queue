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

function parsePort(value: string | undefined): number {
    if (!value) return 3000;
    if (!/^\d+$/.test(value)) {
        throw new ConfigError("PORT must be a valid integer between 0 and 65535");
    }
    const p = Number(value);
    if (!Number.isInteger(p) || p < 0 || p > 65535) {
        throw new ConfigError("PORT must be a valid integer between 0 and 65535");
    }
    return p;
}

function parsePositiveInt(name: string, value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    if (!/^\d+$/.test(value)) {
        throw new ConfigError(`${name} must be a positive integer`);
    }
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
        throw new ConfigError(`${name} must be a positive integer`);
    }
    return num;
}

function parseApiToken(value: string | undefined): string {
    const apiToken = value?.trim();
    if (!apiToken) {
        throw new ConfigError("QUEUE_API_TOKEN must be a non-empty string");
    }
    // Bearer credentials (RFC 6750 §2.1, RFC 9110 §11.1) carry no internal
    // whitespace, and request parsing collapses whitespace when splitting the
    // scheme from the token. A configured token containing any would therefore
    // never match an incoming header, locking out every authenticated endpoint
    // while /health still reports the server as up. Fail closed at startup.
    if (/\s/.test(apiToken)) {
        throw new ConfigError("QUEUE_API_TOKEN contains invalid whitespace");
    }
    return apiToken;
}

export function parseConfig(env: Record<string, string | undefined>, args: string[]): Config {
    const flags = parseArgs(args, {
        boolean: ["persist"],
        default: { persist: false },
    });

    const port = parsePort(env["PORT"]);
    const queueDepthLimit = parsePositiveInt("QUEUE_DEPTH_LIMIT", env["QUEUE_DEPTH_LIMIT"], 10000);
    const queueCountLimit = parsePositiveInt("QUEUE_COUNT_LIMIT", env["QUEUE_COUNT_LIMIT"], 1000);
    const rateLimitRequests = parsePositiveInt("RATE_LIMIT_REQUESTS", env["RATE_LIMIT_REQUESTS"], 100);
    const apiToken = parseApiToken(env["QUEUE_API_TOKEN"]);

    return {
        host: env["HOST"] || "127.0.0.1",
        port,
        persistDir: env["PERSIST"] || Deno.cwd(),
        apiToken,
        queueDepthLimit,
        queueCountLimit,
        rateLimitRequests,
        persistEnabled: flags.persist,
    };
}

