# Graceful Shutdown Implementation for queue-87j

## Changes Made

### 1. main.ts
- Added SIGINT and SIGTERM signal handlers using `Deno.addSignalListener`
- Captured `Deno.serve()` return value into `server` variable
- Added `shutdown()` async function that:
  - Calls `server.shutdown()` to stop accepting new connections
  - Calls `mgr.save()` to snapshot queue state to persist file (when using File persistency)
  - Calls `persist.clear()` to ensure clean exit
  - Calls `Deno.exit(0)`

### 2. src/manager.ts
- Added `save()` method to `Manager` class that:
  - Clears the persist file
  - Iterates over all queues and writes each item as an enqueue operation
  - Produces a clean snapshot of current state

### 3. tests/shutdown_test.ts
- Added two tests:
  1. SIGTERM test: starts server as subprocess, enqueues data, sends SIGTERM, verifies persist data
  2. SIGINT test: starts server as subprocess, verifies health endpoint, sends SIGINT, verifies exit code 0

### 4. Dockerfile
- Added `--allow-sys` to `deno compile` command for signal handling permissions
- Already uses exec form CMD `["/usr/bin/queue"]` which is correct for signal propagation

### Known Issue
Tests need `--allow-sys` permission for `Deno.addSignalListener`. In subprocess tests, use `--allow-all`.
Server startup in tests needs port 0 to avoid conflicts, with stdout parsing to get actual port.
