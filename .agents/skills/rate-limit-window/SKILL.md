---
name: rate-limit-window
description: "Check the per-client sliding request limit when changing RateLimiter.isAllowed, its clock source, timestamp compaction, or stale-entry cleanup."
---

# Verify the per-client sliding request limit

Use this skill when changing `RateLimiter.isAllowed()` in `src/rate_limiter.ts`, especially its clock source, freshness cutoff, binary search, timestamp compaction, or cleanup path.

## Property and harm

A client must not be admitted more than `RATE_LIMIT_REQUESTS` times in any sliding minute measured by elapsed time. The limiter currently stores wall-clock readings, so a clock correction can break its sorted-timestamp assumption and make it forget a still-relevant request.

## Verification

Use the pstack [`/statechart`](../../../../../.agents/skills/statechart/SKILL.md) skill to check `RateLimitWindow.tla` with its adjacent config. Read every invariant result with `/statechart`; replay each reported request and clock reading against `src/rate_limiter.ts` before deciding whether the code or model is wrong.

Run the real-handler guard with Deno 2.7.6:

```sh
deno run --allow-write .agents/skills/rate-limit-window/reproduce-clock-rollback.ts
```

The guard sends authenticated requests through `createHandler()`. Its monotonic control must return three 200 responses followed by 429. It then replays the model's shortest counterexample and a rollback-then-recovery trace, assigning 10 seconds of elapsed time between calls. Both traces currently receive four 200 responses and fail the invariant at request four. Treat that as a code finding, not a reason to weaken the property. The finding is tracked in [issue #201](https://github.com/jonbaldie/queue/issues/201).

The model follows the single-client timestamp path in `RateLimiter.isAllowed()`: it uses the same strict cutoff, binary search, stale-prefix compaction, admission check, and append. It tracks monotonic elapsed time separately from the supplied wall-clock readings, advances elapsed time by 10 seconds per request, and asserts that no more than three admissions occur within any 60-second elapsed window. The finite model uses four wall-clock readings and at most six requests. Its shortest counterexample is replayed by the real-code guard: after a rollback from the initial 100,000 ms clock reading to 90,000 ms, requests read `[90000, 90000, 90000, 160000]`, one request every 10 seconds, and all four receive 200 responses. The guard also replays rollback followed by clock recovery. It first checks a monotonic control that must return three 200 responses followed by 429. Six requests do not reach the periodic sweep, and one client avoids key eviction.

This check does not model concurrent handlers, multiple client keys, periodic map-wide sweeps, eviction at `maxTrackedKeys`, actual operating-system clock discipline, or full HTTP server scheduling. The model assumes requests are exactly 10 seconds apart; the handler guard substitutes `Date.now()` readings and checks the elapsed-time invariant without sleeping. `Date.now()` is not guaranteed to be monotonic; the comment in `isAllowed()` about ordered injected times does not make its production default monotonic.

**Coverage record:** `src/rate_limiter.ts`, `createHandler()` in `src/handler.ts`, and the timestamp aging path exercised by the guard above.

**Sync commit:** `bb9e8ad22fc588fb317410eee93af9c07f97f3b4`.

Move the sync commit forward only after confirming the model and real-handler guard still describe the code at the new commit. If the time source or storage algorithm changes, update both checks and re-run them. Use `/maintain-formal-verification-skill` after changes that did not receive this recheck.
