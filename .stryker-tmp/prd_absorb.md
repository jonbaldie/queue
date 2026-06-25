## Problem Statement

The Queue module (`queue.ts`) is a 34-line wrapper around JavaScript's built-in `Array<T>` that adds no meaningful behaviour. Its 6-method interface maps 1:1 onto Array operations (`push`, `shift`, `[0]`, `length`, spread). The Manager module is its sole caller, meaning the indirection through Queue provides no leverage to anyone — understanding how the queue service manages FIFO ordering requires bouncing between two modules when one would suffice. The real bugs (FIFO order, empty-queue cleanup, persistence synchronisation) all live in Manager, not Queue.

## Solution

Inline Queue's behaviour into Manager. Replace Manager's internal `Map<string, Queue<T>>` with `Map<string, Array<T>>`. Delete `queue.ts`. Remove Queue-specific unit tests that merely re-test Array semantics. Manager's public interface does not change.

## User Stories

1. As a maintainer, I want FIFO queue behaviour concentrated in one module, so that I can understand and debug ordering issues without cross-referencing two files.
2. As a maintainer, I want to eliminate the Queue wrapper, so that the codebase has fewer modules to navigate when tracing a payload's lifecycle.
3. As a contributor adding a new queue operation (e.g. bulk enqueue), I want to add it in one place (Manager), so that I don't have to decide whether logic belongs in Queue or Manager.
4. As a test author, I want to delete ~40 lines of Queue-specific unit tests, so that the test suite only covers behaviour that isn't already guaranteed by JavaScript's Array.
5. As a code reviewer, I want Manager's depth to increase, so that the ratio of interface to implementation reflects the real complexity hidden behind it.
6. As an AI agent navigating the codebase, I want fewer modules with clearer ownership, so that I can locate FIFO-related code without ambiguity.
7. As a mutation tester, I want queue operations tested at the Manager level, so that mutants in FIFO logic are caught by tests that exercise the real call path.
8. As a maintainer, I want the empty-queue cleanup logic to live next to the array it operates on, so that there's no abstraction layer between the cleanup decision and the data structure.

## Implementation Decisions

- Manager's internal storage changes from `Map<string, Queue<T>>` to `Map<string, Array<T>>`.
- `queue.ts` is deleted entirely.
- Array operations used: `push()` for enqueue, `shift()` for dequeue, `[0]` for peek, `.length` for length, spread `[...arr]` for `all()`.
- Manager's public interface (`enqueue`, `dequeue`, `peek`, `length`, `listQueues`, `save`, `load`, `canEnqueue`, `canCreateQueue`) remains unchanged.
- The `is_empty()` method on Queue is not used by Manager and will not be replicated — `array.length === 0` is used inline.
- No new modules are introduced. This is strictly a simplification.

## Testing Decisions

- **Test surface**: All tests exercise Manager through its public interface (`enqueue`, `dequeue`, `peek`, `length`, `listQueues`, `save`, `load`). This is the existing seam.
- **Good tests**: Test observable FIFO behaviour ("enqueue A then B, dequeue returns A first") through the Manager interface, not internal array operations.
- **Deleted tests**: Queue-specific unit tests in `test.ts` (lines ~281-323) that test `enqueue`/`dequeue`/`length`/`is_empty` on a bare Queue instance. These test Array semantics already covered by Manager tests.
- **Retained tests**: All Manager tests, Handler integration tests, persistence round-trip tests, and shutdown tests. These already cross the Manager seam and will continue to work unchanged.
- **Prior art**: `tests/test.ts` lines 325-353 ("manager enqueue", "manager length") demonstrate the pattern — test FIFO behaviour through the Manager interface.
- **Mutation testing**: Existing mutasaurus and Stryker configurations continue to work. The mutation/stryker.config.json may need `queue.ts` removed from its source file list.

## Out of Scope

- Changing Manager's public interface.
- Introducing new data structures (e.g. linked list for O(1) dequeue).
- Refactoring the Handler or Persistence modules — those are separate candidates.
- Performance optimisation of `Array.shift()` — this is a known O(n) operation but is acceptable at the current scale.

## Further Notes

This is the smallest and safest of the architecture candidates. It should be done first because Candidate 1 (Deepen the Handler) may benefit from a simplified Manager. Apply the deletion test: deleting Queue concentrates complexity in Manager (good) without spreading it to other callers (Manager is the only caller).
