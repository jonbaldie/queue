## Problem Statement

The Manager module owns the serialisation format for persistence entries. It calls `JSON.stringify({ queue, payload, enqueue, dequeue })` in four places (`enqueue`, `dequeue`, `save`, and `load`) and parses the same shape back in `load()`. The `LoadLine` interface is defined inside `manager.ts` even though it conceptually describes the persistence format. The Persist interface deals only in raw strings — it has no knowledge of the operation structure it stores. If the persistence format ever needed to change (binary, protobuf, WAL with checksums), Manager would need surgery in four places.

## Solution

Deepen the Persist interface to accept and return typed operations instead of raw strings. The serialisation format becomes an internal detail of the File adapter. Manager calls `persist.appendEnqueue(name, payload)` / `persist.appendDequeue(name, payload)` / `persist.loadOperations()` and never touches JSON directly. The `LoadLine` type moves into persist.ts.

## User Stories

1. As a maintainer, I want the persistence format defined in one place (the persistence adapter), so that changing it means touching one file, not four call sites in Manager.
2. As a maintainer, I want Manager to speak in domain operations (enqueue, dequeue), not raw JSON strings, so that Manager's code reads as business logic rather than serialisation code.
3. As a contributor changing the persistence format (e.g. adding checksums), I want to modify only the File adapter, so that Manager is unaffected.
4. As a test author, I want persistence round-trip tests to use typed operations, so that tests describe intent ("enqueue then dequeue = empty") rather than constructing raw JSON.
5. As a maintainer, I want the `LoadLine` type owned by the persistence module, so that the type lives next to the code that produces and consumes it.
6. As a future maintainer adding WAL compaction, I want the persistence seam to already accept typed operations, so that compaction logic can be added inside the adapter without changing Manager.
7. As a mutation tester, I want the serialisation format encapsulated, so that format mutations are caught by persistence-level tests rather than requiring Manager-level coverage.
8. As a contributor, I want the `None` adapter's no-op implementation to remain trivial, so that the typed interface doesn't add unnecessary complexity to the no-persistence path.

## Implementation Decisions

- The Persist interface changes from `append(line: string)` / `load(): string` to `appendEnqueue(queue: string, payload: T)` / `appendDequeue(queue: string, payload: T)` / `loadOperations(): Operation<T>[]` / `clear()` / `dir(dir: string)`.
- A new `Operation<T>` type: `{ queue: string, payload: T, type: 'enqueue' | 'dequeue' }`. This replaces `LoadLine` and the `{ enqueue: boolean, dequeue: boolean }` shape.
- The `File` adapter handles JSON serialisation internally. The on-disk format does not change (backward compatible).
- The `None` adapter's methods remain no-ops: `appendEnqueue`/`appendDequeue` do nothing, `loadOperations` returns `[]`.
- Manager's `save()` calls `persist.appendEnqueue()` per item. Manager's `load()` iterates `persist.loadOperations()` and applies each operation.
- The boolean `enqueue`/`dequeue` pair is replaced by a discriminated union `type: 'enqueue' | 'dequeue'` — this eliminates the impossible state where both are true.

## Testing Decisions

- **Test surface**: Persistence is tested through the Persist interface (`appendEnqueue`, `loadOperations`, `clear`). Manager is tested through its own interface as before.
- **Good tests**: Test round-trip semantics ("append enqueue + append dequeue + load = expected operations") through the Persist interface. Do not test the internal JSON format — that's an implementation detail of the File adapter.
- **Prior art**: `tests/persist_coverage_test.ts` and `tests/test.ts` (lines 355-406) demonstrate persistence testing patterns. These will be updated to use typed operations.
- **Retained tests**: All Manager-level and Handler-level tests continue to work — they don't care about the persistence format.
- **New tests**: Round-trip test for `File.loadOperations()` verifying the typed operations match what was appended.

## Out of Scope

- Changing the on-disk format (JSON newline-delimited). The format stays the same; only the ownership of serialisation moves.
- Adding WAL compaction, checksums, or binary formats — this refactor creates the seam for those, but doesn't implement them.
- Modifying the Handler or Queue modules.

## Further Notes

This candidate becomes more urgent if the persistence format needs to change. It's a "worth exploring" priority — do it after the Handler and Queue absorptions. The impossible state elimination (`enqueue: true, dequeue: true`) is a small correctness win on its own.
