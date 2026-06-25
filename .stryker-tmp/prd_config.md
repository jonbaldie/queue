## Problem Statement

Configuration parsing in `main.ts` is scattered: 7 `Deno.env.get()` calls, 3 `parseInt()` calls with fallbacks, flag parsing via `parseArgs`, and conditional wiring (persist type depends on `--persist` flag). This code is entirely untested because `main.ts` is a top-level script with side-effects — there's no seam to test configuration parsing without starting the server. A config value like `PORT=abc` silently becomes `NaN`. The Dockerfile's `deno compile` flags must mirror the env vars, and any mismatch is silent.

## Solution

Extract a Config module with a pure function `parseConfig(env, args) → Config` that reads environment variables and CLI flags, validates them, and returns a typed config object. `main.ts` becomes a thin composition root: parse config → build dependencies → start server. The Config module is testable without Deno.serve side-effects.

## User Stories

1. As a maintainer, I want all env var parsing in one module, so that "what config does this service read?" is answered by reading one file.
2. As a maintainer, I want invalid config values (e.g. `PORT=abc`) to throw a clear error at startup, so that misconfiguration is caught immediately rather than causing runtime surprises.
3. As a contributor, I want a typed Config object, so that downstream code gets type-safe access to config values rather than stringly-typed env vars.
4. As a test author, I want to test config parsing with invalid inputs, so that I can verify error messages without spawning a server process.
5. As a DevOps engineer, I want to see all config defaults in one place, so that I know what values the service uses when env vars are unset.
6. As a Docker user, I want config parsing to validate that required values are present, so that a misconfigured container fails fast with a clear message.
7. As a maintainer, I want `main.ts` to be a 10-line composition root, so that the startup flow is immediately obvious.
8. As a contributor, I want config parsing separated from server startup, so that I can add new config values without risk of breaking the startup sequence.
9. As an AI agent, I want config documented as a typed interface, so that I can determine all configurable values without parsing scattered `Deno.env.get()` calls.
10. As a maintainer, I want the `parseInt` + fallback pattern centralised, so that all numeric env vars use the same parsing logic.

## Implementation Decisions

- New module with a pure function: `parseConfig(env: Record<string, string | undefined>, args: string[]) → Config`.
- The `Config` type includes: `host: string`, `port: number`, `persistDir: string`, `apiToken: string`, `queueDepthLimit: number`, `queueCountLimit: number`, `rateLimitRequests: number`, `persistEnabled: boolean`.
- Validation: `port` must be a valid integer (1-65535). `queueDepthLimit`, `queueCountLimit`, `rateLimitRequests` must be positive integers. Invalid values throw with a descriptive message.
- Default values are defined as constants within the Config module.
- `main.ts` calls `parseConfig(Deno.env.toObject(), Deno.args)` and uses the result to construct dependencies.
- The function accepts env and args as parameters (not reading globals directly) to make it testable.

## Testing Decisions

- **Test surface**: The new `parseConfig` function — a pure function seam. Pass in env/args objects, assert the returned Config or thrown error.
- **Good tests**: Test with valid config, missing optional values (verify defaults), invalid numeric values (verify error), missing required values if any.
- **Prior art**: No existing config tests — this is a new test surface. The pattern is simple: pure function in, typed object out.
- **No server startup needed**: Tests call `parseConfig()` directly. No Deno.serve, no network, no file system.

## Out of Scope

- Config file support (YAML, TOML, .env files). Env vars and CLI flags only.
- Hot-reloading of config values.
- Modifying the Handler, Manager, or Persistence modules.
- Changing the Dockerfile's deno compile flags — though those should be reviewed for consistency after this change.

## Further Notes

This is independent of the other architecture candidates and can be done in any order. It's a quality-of-life improvement that prevents silent misconfiguration. The `QUEUE_API_TOKEN` defaulting to empty string is worth flagging — an empty token means all requests pass auth, which may be intentional for development but surprising in production.
