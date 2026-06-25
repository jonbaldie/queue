## Problem Statement

The HTTP handler (`handler.ts`) is a 180-line function organised as a flat `if/else` chain — one branch per route. Cross-cutting concerns (auth, rate limiting, body-size enforcement, queue-name validation, HTTP method enforcement) are copy-pasted into each branch rather than concentrated. Queue-name length validation appears 4 times identically. Method enforcement appears 5 times. Response serialisation (object → JSON, primitive → text, undefined → 204) is duplicated between dequeue and peek. Adding a new endpoint means inserting into the middle of the function and remembering to copy all guards. The handler is shallow: its interface (`(Request) → Response`) hides almost nothing because the implementation is a mechanical sequence of pattern matches with repeated guards.

## Solution

Deepen the handler by extracting routing, middleware, and response serialisation into the module's implementation — behind the same `(Request) → Response` interface. Each route becomes a small, focused handler function. Auth, rate-limiting, queue-name validation, and method enforcement become a middleware pipeline applied declaratively per route. Response serialisation becomes a shared helper.

## User Stories

1. As a maintainer, I want queue-name validation to live in one place, so that a fix to validation logic doesn't require updating 4 identical code blocks.
2. As a maintainer, I want method enforcement to live in one place, so that adding a new endpoint doesn't risk forgetting the method check.
3. As a maintainer, I want response serialisation (object → JSON, primitive → text) to live in one shared function, so that dequeue and peek stay consistent.
4. As a contributor adding a new endpoint, I want to write a 5-line handler function and declare its method/middleware, so that I don't have to thread through a 180-line if/else chain.
5. As a test author, I want a single middleware test to cover auth/rate-limit/validation for all routes, so that the test suite doesn't need N×M tests for N routes × M guards.
6. As a code reviewer, I want each route handler to contain only its business logic, so that reviews focus on what the route does rather than whether it remembered all the guards.
7. As a maintainer, I want the 6 URLPattern objects to short-circuit on first match, so that every request doesn't evaluate all patterns unnecessarily.
8. As a maintainer, I want the health endpoint's middleware exemption (no auth, no rate limit) to be declared at the route level, so that the exemption is visible in the route table rather than buried in control flow.
9. As an AI agent navigating the codebase, I want each route's logic isolated in its own function, so that I can locate and modify a single endpoint without parsing the entire handler.
10. As a mutation tester, I want shared middleware tested once at a high level, so that mutants in auth or validation are caught without relying on coverage from every route's test.
11. As a maintainer, I want the body-size check for enqueue concentrated in one place, so that the two-phase check (Content-Length header then actual body) is clearly a single responsibility.
12. As a user of the queue service, I want consistent error responses across all endpoints, so that my client code can handle errors uniformly.

## Implementation Decisions

- The handler's public interface remains `(Request, Deno.ServeHandlerInfo?) → Response`. No change to how `main.ts` calls it.
- A route table maps `{ pattern: URLPattern, method: string, middleware: string[], handler: Function }`. Routes are matched in order; first match wins.
- Middleware functions follow a `(Request, next) → Response` pattern. Each middleware can short-circuit (return early) or call `next()`.
- Standard middleware: `rateLimit`, `auth`, `validateQueueName`, `enforceMethod`. The health endpoint declares no middleware.
- A `serializePayload(item)` helper handles the object/primitive/undefined → Response conversion used by dequeue and peek.
- All route handlers receive the already-validated queue name (extracted from URLPattern groups) as a parameter, not the raw request.
- Constants (`MAX_BODY_SIZE`, `MAX_QUEUE_NAME_LENGTH`) remain in `handler.ts` as implementation details.
- The outer wrapper (logging, timing) remains as-is — it wraps the entire route dispatch.

## Testing Decisions

- **Test surface**: All tests exercise the handler through its public interface: `(Request) → Response`. This is the existing, highest seam.
- **Good tests**: Send an HTTP request, assert the response status/body/headers. Do not test internal middleware functions directly — test them through routes.
- **Middleware coverage**: A small set of tests verifies that middleware applies across routes (e.g. "unauthenticated request to any protected endpoint returns 401"). This replaces the current N-per-route pattern.
- **Route-specific tests**: Each route's test covers only its business logic (e.g. "enqueue with valid payload returns 200"), not guards.
- **Prior art**: `tests/auth_test.ts` demonstrates the pattern — test auth through HTTP requests, not by calling internal auth functions.
- **Serialisation tests**: `tests/response_body_test.ts` tests are retained but consolidated — they test `serializePayload` indirectly through dequeue/peek responses.

## Out of Scope

- Changing the HTTP interface (URL patterns, status codes, response formats).
- Introducing a framework or router library — this is hand-rolled internal decomposition.
- Modifying the Manager or Persistence modules.
- Adding new endpoints — this refactor prepares the ground but doesn't add features.

## Further Notes

This should be done after "Absorb Queue into Manager" because the Manager interface simplification may slightly affect how route handlers call into it. The handler deepening also sets up the test suite for a future test file reorganisation.
