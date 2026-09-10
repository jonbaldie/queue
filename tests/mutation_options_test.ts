import { assertEquals } from "jsr:@std/assert";
import { buildStrykerCommandArgs } from "../mutation/runner_options.ts";

Deno.test("mutation runner passes Stryker concurrency as separate arguments", () => {
  const configFilePath = "mutation/config $name &.json";
  assertEquals(
    buildStrykerCommandArgs(configFilePath, 1),
    [
      "--no-install",
      "stryker",
      "run",
      "--concurrency",
      "1",
      configFilePath,
    ],
  );
});

Deno.test("mutation runner leaves Stryker config default untouched when omitted", () => {
  assertEquals(
    buildStrykerCommandArgs("mutation/stryker.config.json"),
    ["--no-install", "stryker", "run", "mutation/stryker.config.json"],
  );
});
