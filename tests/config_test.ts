import { assertEquals, assertThrows } from "jsr:@std/assert@1.0";
import { parseConfig, ConfigError } from "../src/config.ts";

Deno.test("parseConfig - returns defaults when no env or args provided", () => {
    const config = parseConfig({}, []);
    assertEquals(config.host, "localhost");
    assertEquals(config.port, 3000);
    assertEquals(typeof config.persistDir, "string");
    assertEquals(config.apiToken, "");
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

Deno.test("parseConfig - parses numeric environment variables correctly", () => {
    const env = {
        PORT: "8080",
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
    const config = parseConfig({}, ["--persist"]);
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
