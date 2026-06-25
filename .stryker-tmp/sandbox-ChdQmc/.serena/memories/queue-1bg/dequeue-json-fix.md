# Queue-1bg: Dequeue JSON Payload Fix

## Problem
The handler returns `new Response(item)` for dequeue, which causes `[object Object]` for JSON object payloads because Response stringifies via `.toString()`.

## Fix Applied
In `src/handler.ts`, for both `isDequeue` and `isPeek` blocks:
- Added a check: if `typeof item === "object" && item !== null`, return `new Response(JSON.stringify(item), { headers: { "Content-Type": "application/json" } })`
- Otherwise, continue with `new Response(item)` for strings/numbers/booleans

## Tests Added
Tests in `tests/test.ts` for:
- Object payload → `application/json`
- Array payload → `application/json`
- Number payload → text body "42"
- Boolean payload → text body "true"
- String payload → text body "hello world"

## Files Modified
- `.worktrees/queue-1bg/src/handler.ts`
- `.worktrees/queue-1bg/tests/test.ts`
