# Queue Service (jonbaldie/queue)

Operational knowledge for agents working on this Deno-based queue service.

Use available Serena tools when appropriate, e.g. IDE-like code symbol search,
and respect .serena as integral project tooling

## Project Overview

- **Runtime**: Deno 2.7.6 (upgraded via PR #3)
- **Main components**: Queue FIFO data structure, QueueManager, HTTP handler with bearer token auth, persistence layer

## Deno Version Dependency — Critical

**Main branch requires Deno 2.7.6**

### GitHub Actions Configuration

The `.github/workflows/ci.yml` must match the Deno version:
```yaml
uses: denoland/setup-deno@v2
with:
  deno-version: 2.7.6
```

**If you upgrade Deno, ALWAYS update this workflow or CI will fail.**

### Standard Library Imports

Deno 2.x uses JSR format:

Correct: `import { parseArgs } from "jsr:@std/cli/parse-args";`
Old (broken): `import { parse } from "https://deno.land/std@0.119.0/flags/mod.ts";`

### Deno 2.x-Only APIs

- `URLPattern` routing API
- `Deno.serve()` native HTTP server

Do NOT use these in code that must support Deno 1.x.

## persist.ts Quirk

The `clear()` method creates the file if absent:
```ts
Deno.writeFileSync(this.directory + "persist.dat", new Uint8Array());
```

This prevents "file not found" errors in tests.

## Mutation Testing Strategy

Test off-by-one errors, FIFO order, operator mutations, and boundary conditions explicitly.

## Testing Public Interface

Test HTTP handler behaviour with real requests, not internal implementation details.

## Common Diagnostics

**GitHub Actions fails?** Check: (1) workflow Deno version matches code (2) Import format (jsr: vs deno.land) (3) Using Deno 2.x-only APIs

**Merge blocked?** `gh api repos/jonbaldie/queue/branches/main/protection --jq '.enforce_admins.enabled'` — if true, disable with DELETE before merging with --admin

Critical: If the CI fails in remote after your push, then you MUST follow-up even if the cause seems pre-existing.  

## Testing
- Use red/green TDD; use the /tdd skill when editing production code with execution seams.
- Use /diagnosing-bugs when investigating bugs or issues.
- Actually run the code, automated tests by themselves aren't sufficient.
- Use 'tracer bullets', aka canary tests, aka smoke tests, aka E2E tests. 
- Actively look for genuine bugs, edge cases, failure modes - if you find these, then you've succeeded, not failed. 
- No mocks, ever. They're a common escape hatch for writing tautological or pat-self-on-back tests.
