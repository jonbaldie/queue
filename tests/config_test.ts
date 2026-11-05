import { assertEquals, assertThrows } from "jsr:@std/assert@1.0";
import { parseConfig, loadConfig, readEnv, ConfigError } from "../src/config.ts";

Deno.test("loadConfig reads supported environment variables and parses arguments", () => {
    const env: Record<string, string> = {
        HOST: "0.0.0.0",
        PORT: "4321",
        PERSIST: "/tmp/queue-config-test",
        QUEUE_API_TOKEN: "secret",
        QUEUE_DEPTH_LIMIT: "12",
        QUEUE_COUNT_LIMIT: "13",
        RATE_LIMIT_REQUESTS: "14",
        UNRELATED: "ignored",
    };
    const requested: string[] = [];
    const getEnv = (name: string) => {
        requested.push(name);
        return env[name];
    };
    assertEquals(loadConfig(["--persist"], getEnv), {
        host: "0.0.0.0",
        port: 4321,
        persistDir: "/tmp/queue-config-test",
        apiToken: "secret",
        queueDepthLimit: 12,
        queueCountLimit: 13,
        rateLimitRequests: 14,
        persistEnabled: true,
    });
    assertEquals(requested, ["HOST", "PORT", "PERSIST", "QUEUE_API_TOKEN", "QUEUE_DEPTH_LIMIT", "QUEUE_COUNT_LIMIT", "RATE_LIMIT_REQUESTS"]);
});

Deno.test("loadConfig preserves validation errors and readEnv retains missing values", () => {
    const getEnv = (name: string) => name === "PORT" ? "invalid" : undefined;
    assertEquals(readEnv(getEnv).PORT, "invalid");
    assertEquals(readEnv(getEnv).QUEUE_API_TOKEN, undefined);
    assertThrows(() => loadConfig([], getEnv), ConfigError, "PORT must be a valid integer between 0 and 65535");
});

Deno.test("ConfigError - has name ConfigError", () => {
    const err = new ConfigError("test");
    assertEquals(err.name, "ConfigError");
});

Deno.test("parseConfig - returns defaults when only QUEUE_API_TOKEN is provided", () => {
    const config = parseConfig({ QUEUE_API_TOKEN: "test-token" }, []);
    assertEquals(config.host, "127.0.0.1");
    assertEquals(config.port, 3000);
    assertEquals(typeof config.persistDir, "string");
    assertEquals(config.apiToken, "test-token");
    assertEquals(config.queueDepthLimit, 10000);
    assertEquals(config.queueCountLimit, 1000);
    assertEquals(config.rateLimitRequests, 100);
    assertEquals(config.persistEnabled, false);
});

Deno.test("parseConfig - parses string environment variables correctly", () => {
    const env = {
        HOST: "0.0.0.0",
        PERSIST: "/tmp/persist",
        QUEUE_API_TOKEN: "my-secret-token"
    };
    const config = parseConfig(env, []);
    assertEquals(config.host, "0.0.0.0");
    assertEquals(config.persistDir, "/tmp/persist");
    assertEquals(config.apiToken, "my-secret-token");
});

Deno.test("parseConfig - defaults host to 127.0.0.1 when HOST is empty string", () => {
    const config = parseConfig({ QUEUE_API_TOKEN: "test-token", HOST: "" }, []);
    assertEquals(config.host, "127.0.0.1");
});

Deno.test("parseConfig - parses numeric environment variables correctly", () => {
    const env = {
        PORT: "8080",
        QUEUE_API_TOKEN: "test-token",
        QUEUE_DEPTH_LIMIT: "5000",
        QUEUE_COUNT_LIMIT: "500",
        RATE_LIMIT_REQUESTS: "50"
    };
    const config = parseConfig(env, []);
    assertEquals(config.port, 8080);
    assertEquals(config.queueDepthLimit, 5000);
    assertEquals(config.queueCountLimit, 500);
    assertEquals(config.rateLimitRequests, 50);
});

Deno.test("parseConfig - parses --persist flag correctly", () => {
    const config = parseConfig({ QUEUE_API_TOKEN: "test-token" }, ["--persist"]);
    assertEquals(config.persistEnabled, true);
});

Deno.test("parseConfig - throws ConfigError on non-numeric PORT", () => {
    assertThrows(() => parseConfig({ PORT: "abc" }, []), ConfigError, "PORT must be a valid integer between 0 and 65535");
    assertThrows(() => parseConfig({ PORT: "1x" }, []), ConfigError, "PORT must be a valid integer between 0 and 65535");
});

Deno.test("parseConfig - throws ConfigError on out-of-range PORT", () => {
    assertThrows(() => parseConfig({ PORT: "-1" }, []), ConfigError, "PORT must be a valid integer between 0 and 65535");
    assertThrows(() => parseConfig({ PORT: "65536" }, []), ConfigError, "PORT must be a valid integer between 0 and 65535");
});

Deno.test("parseConfig - throws ConfigError on invalid QUEUE_DEPTH_LIMIT", () => {
    assertThrows(() => parseConfig({ QUEUE_DEPTH_LIMIT: "abc" }, []), ConfigError, "QUEUE_DEPTH_LIMIT must be a positive integer");
    assertThrows(() => parseConfig({ QUEUE_DEPTH_LIMIT: "0" }, []), ConfigError, "QUEUE_DEPTH_LIMIT must be a positive integer");
    assertThrows(() => parseConfig({ QUEUE_DEPTH_LIMIT: "-1" }, []), ConfigError, "QUEUE_DEPTH_LIMIT must be a positive integer");
});

Deno.test("parseConfig - throws ConfigError on invalid QUEUE_COUNT_LIMIT", () => {
    assertThrows(() => parseConfig({ QUEUE_COUNT_LIMIT: "abc" }, []), ConfigError, "QUEUE_COUNT_LIMIT must be a positive integer");
    assertThrows(() => parseConfig({ QUEUE_COUNT_LIMIT: "-5" }, []), ConfigError, "QUEUE_COUNT_LIMIT must be a positive integer");
    assertThrows(() => parseConfig({ QUEUE_COUNT_LIMIT: "1x" }, []), ConfigError, "QUEUE_COUNT_LIMIT must be a positive integer");
});

Deno.test("parseConfig - throws ConfigError on invalid RATE_LIMIT_REQUESTS", () => {
    assertThrows(() => parseConfig({ RATE_LIMIT_REQUESTS: "xyz" }, []), ConfigError, "RATE_LIMIT_REQUESTS must be a positive integer");
});

Deno.test("parseConfig - throws ConfigError when QUEUE_API_TOKEN is missing", () => {
    assertThrows(() => parseConfig({}, []), ConfigError, "QUEUE_API_TOKEN must be a non-empty string");
});

Deno.test("parseConfig - throws ConfigError when QUEUE_API_TOKEN is empty", () => {
    assertThrows(() => parseConfig({ QUEUE_API_TOKEN: "" }, []), ConfigError, "QUEUE_API_TOKEN must be a non-empty string");
});

Deno.test("parseConfig - throws ConfigError when QUEUE_API_TOKEN is whitespace-only", () => {
    assertThrows(() => parseConfig({ QUEUE_API_TOKEN: " " }, []), ConfigError, "QUEUE_API_TOKEN must be a non-empty string");
    assertThrows(() => parseConfig({ QUEUE_API_TOKEN: "   " }, []), ConfigError, "QUEUE_API_TOKEN must be a non-empty string");
    assertThrows(() => parseConfig({ QUEUE_API_TOKEN: "\t" }, []), ConfigError, "QUEUE_API_TOKEN must be a non-empty string");
    assertThrows(() => parseConfig({ QUEUE_API_TOKEN: " \t \r\n " }, []), ConfigError, "QUEUE_API_TOKEN must be a non-empty string");
});

Deno.test("parseConfig - trims leading and trailing whitespace from QUEUE_API_TOKEN", () => {
    const config = parseConfig({ QUEUE_API_TOKEN: "  my-secret-token  " }, []);
    assertEquals(config.apiToken, "my-secret-token");
});
