# Queue Service (jonbaldie/queue)

Operational knowledge for agents working on this Deno-based queue service.

## Project Overview

- **Runtime**: Deno 2.7.6 (upgraded via PR #3)
- **Main components**: Queue FIFO data structure, QueueManager, HTTP handler with bearer token auth, persistence layer

## Deno Version Dependency — Critical

**Main branch requires Deno 2.7.6**

### CircleCI Configuration

The `.circleci/config.yml` must match the Deno version:
```yaml
docker:
  - image: denoland/deno:2.7.6
```

**If you upgrade Deno, ALWAYS update this image or CI will fail.**

### Standard Library Imports

Deno 2.x uses JSR format:

✅ Correct: `import { parseArgs } from "jsr:@std/cli/parse-args";`
❌ Old: `import { parse } from "https://deno.land/std@0.119.0/flags/mod.ts";`

### Deno 2.x-Only APIs

- `URLPattern` — routing API (Deno 2.x only)
- `Deno.serve()` — native HTTP server (Deno 2.x only)

Do NOT use these if code must support Deno 1.x.

## persist.ts Quirk

The `clear()` method creates the file if absent:
```ts
Deno.writeFileSync(this.directory + "persist.dat", new Uint8Array());
```

This prevents "file not found" errors in tests.

## PR Dependencies

PR #2 (Bearer Token Auth) depends on PR #3 (Deno 2.x). Merge order: PR #3 → PR #2

## Mutation Testing Strategy

Test off-by-one errors, FIFO order, operator mutations (=== vs >), and boundary conditions.

## Testing Public Interface

Test HTTP handler behavior with real requests, not internal implementation details.

## Common Diagnostics

**CircleCI fails?** Check: (1) CircleCI Deno version (2) Import format (3) Deno 2.x-only APIs

**Merge blocked?** Query branch protection: `gh api repos/jonbaldie/queue/branches/main/protection --jq '.enforce_admins.enabled'`
