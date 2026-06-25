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

## PR Dependencies

PR #2 (Bearer Token Auth) depends on PR #3 (Deno 2.x). Merge order: PR #3 first, then PR #2.

## Mutation Testing Strategy

Test off-by-one errors, FIFO order, operator mutations, and boundary conditions explicitly.

## Testing Public Interface

Test HTTP handler behaviour with real requests, not internal implementation details.

## Common Diagnostics

**CircleCI fails?** Check: (1) CircleCI Deno version matches code (2) Import format (jsr: vs deno.land) (3) Using Deno 2.x-only APIs

**Merge blocked?** `gh api repos/jonbaldie/queue/branches/main/protection --jq '.enforce_admins.enabled'` — if true, disable with DELETE before merging with --admin

Critical: If the CI fails in remote after your push, then you MUST follow-up even if the cause seems pre-existing.  

## Testing
- Use red/green TDD. 
- Actually run the code, automated tests by themselves aren't sufficient.
- Use 'tracer bullets', aka canary tests, aka smoke tests, aka E2E tests. 
- Actively look for genuine bugs, edge cases, failure modes - if you find these, then you've succeeded, not failed. 
- No mocks, ever. They're a common escape hatch for writing tautological or pat-self-on-back tests.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
