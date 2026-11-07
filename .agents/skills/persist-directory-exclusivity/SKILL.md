---
name: persist-directory-exclusivity
description: "Check that only one queue server can use a PERSIST directory at a time. Use when changing FileStore ownership, PERSIST startup, or server shutdown and lock release."
---

# Verify exclusive PERSIST directory ownership

Use this skill when changing `FileStore.claimDirectory()`, `FileStore.dir()`, `FileStore.close()`, or the startup and shutdown path in `main.ts`.

## Property and harm

At most one queue server may serve from a given `PERSIST` directory at a time. If two processes load the same persisted item into separate in-memory queues, both can deliver it, and one process's snapshot can erase the other's work.

## Verification

Use the pstack [`/statechart`](../../../../../.agents/skills/statechart/SKILL.md) skill to check `PersistDirectory.tla` with its adjacent `PersistDirectory.cfg`. Read every reported invariant result with `/statechart`; a reported path is a sequence of queue-server events to replay against the implementation.

Run the real-code guard with Deno 2.7.6, the version pinned by this repository:

```sh
deno test --allow-all tests/shared_persist_dir_test.ts tests/persist_test.ts
```

The integration test starts real queue server processes and checks that a second process cannot serve from the same directory, then checks that the operating system releases the lock after its owner is killed. The persistence tests cover repeated claims, release on close, and release when changing directories.

If the model reports `NoJobDeliveredTwice`, write down the reported path in terms of the two server processes and run the real-process tests above. A model counterexample that cannot be replayed usually means the model no longer matches startup or shutdown code; inspect that mapping before changing an invariant. A failure in the real-process test is a product regression. Do not weaken either property to make a check pass.

## Model boundary

The model exhaustively checks every startup, refusal, restart-after-refusal, dequeue, and stop ordering for two server processes, one `PERSIST` directory, and one pending job. It treats `tryLockSync(true)` as an atomic claim, treats the queue log and dequeue as atomic, and treats process exit as releasing the operating-system lock. It does not model the operating system's lock implementation, more than two processes, multiple jobs or queues, filesystem durability, or a crash between a persisted dequeue and its HTTP response. The real-process tests cover the Deno file-lock integration for the current host.

The TLA model abstracts `FileStore.claimDirectory()` into atomic lock acquisition or refusal, and `FileStore.close()` or process exit into lock release. Its startup step reflects `main.ts` claiming the directory before `MANAGER.load()` and `Deno.serve()`. It does not model `FileStore.dir()` changing paths or repeated claims by the same store; the `claimDirectory` tests in `tests/persist_test.ts` cover those cases. The shared-process behavior is guarded by `tests/shared_persist_dir_test.ts`.

**Sync commit:** `47f64f469bbe385aac03811f62c3e5db9d193419`.

Move the sync commit forward only after checking that the model and this coverage record still describe the code at the new commit. When ownership or startup behavior intentionally changes, update the model, its view, and this scope; then rerun both checks.
