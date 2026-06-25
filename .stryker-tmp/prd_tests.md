## Problem Statement

The test suite has 10 files totalling ~105 KB, organised by how they were added (PR history, mutation survival) rather than by which module's interface they exercise. The primary file `test.ts` is 829 lines containing Queue unit tests, Manager unit tests, Handler integration tests, Persistence tests, and rate-limiter tests — all in one flat file. Auth tests exist in both `test.ts` and `auth_test.ts`. Rate limiter tests span three files. When reading a test file, you can't tell which module's interface is the intended test surface.

## Solution

Reorganise tests by module interface: one primary test file per module being tested through its public interface. Delete tests that exercise internal details already covered at a higher interface. Make the test file structure mirror the source module structure. Add an E2E test file for full server lifecycle tests.

## User Stories

1. As a maintainer, I want to answer "how is the handler tested?" by reading `handler_test.ts`, so that I don't have to search across 10 files.
2. As a contributor adding a handler feature, I want to know exactly which test file to add my test to, so that tests don't end up scattered by accident.
3. As a code reviewer, I want test files named after the module they test, so that I can quickly verify coverage for the module being changed.
4. As a maintainer, I want duplicate tests removed, so that a failing test doesn't have a passing duplicate elsewhere creating false confidence.
5. As an AI agent, I want a 1:1 mapping between source modules and test files, so that I can locate relevant tests without full-text search.
6. As a mutation testing maintainer, I want the Stryker config to reference test files that correspond to source files, so that mutation coverage is traceable.
7. As a contributor, I want E2E tests (server start, request, shutdown) separated from unit/integration tests, so that I can run fast tests independently.
8. As a maintainer, I want each test file to import only the module it tests, so that test dependencies are explicit and minimal.
9. As a new contributor, I want the test structure to be self-documenting, so that I understand the architecture by reading the test file names.
10. As a maintainer, I want to eliminate the 829-line `test.ts` catch-all, so that no single test file becomes a dumping ground.

## Implementation Decisions

- Target test file structure: `handler_test.ts` (all HTTP handler tests), `manager_test.ts` (all Manager interface tests), `persist_test.ts` (all persistence tests), `rate_limiter_test.ts` (all rate limiter tests), `e2e_test.ts` (full server lifecycle: start, request, shutdown, persist round-trip).
- `test.ts` is deleted entirely. Its contents are distributed to the appropriate module-specific files.
- `auth_test.ts` contents merge into `handler_test.ts` (auth is tested through the handler interface).
- `limits_test.ts`, `response_body_test.ts`, `mutation_behavior_test.ts`, `type_safety_test.ts` contents merge into `handler_test.ts` and/or `manager_test.ts` based on which interface they exercise.
- `persist_coverage_test.ts` merges into `persist_test.ts`.
- `rate_limiter_coverage_test.ts` merges into `rate_limiter_test.ts`.
- `shutdown_test.ts` Manager unit tests move to `manager_test.ts`; server lifecycle tests move to `e2e_test.ts`.
- No test logic changes — this is a pure file reorganisation. Tests are moved, not rewritten.
- The mutation testing configs (mutasaurus, Stryker) are updated to reference the new file names.

## Testing Decisions

- **Meta-test**: Run the full test suite before and after reorganisation. The same number of tests should pass. No test should be lost or duplicated.
- **Mutation testing**: Run both mutasaurus and Stryker after reorganisation to verify mutation scores are preserved.
- **Good tests**: Each test file exercises exactly one module's public interface. Helpers (e.g. `makeHandler()`, `startServer()`) are defined in the file that uses them, or in a shared `test_helpers.ts` if used by multiple files.

## Out of Scope

- Rewriting test logic or changing assertions.
- Adding new tests — this is reorganisation only.
- Changing source modules.
- Modifying CI configuration beyond updating file references.

## Further Notes

This should be done after Candidates 1 and 2 (Deepen Handler, Absorb Queue), because those refactors will change which tests exist and how they're structured. Doing reorganisation first would create merge conflicts with those refactors. This is a speculative priority — the benefit is navigability and maintainability, not correctness.
