# Queue Service - Project Overview

## Purpose
Fast, lightweight, persistence-optional FIFO queue service written in TypeScript for Deno. Provides HTTP API for enqueue, dequeue, length, peek, queues list, and health check endpoints.

## Tech Stack
- **Runtime**: Deno 2.7.6 (critical - must match CI image)
- **Language**: TypeScript
- **Imports**: JSR format (e.g. `jsr:@std/cli@1.0/parse-args`)
- **CI**: CircleCI (image: `denoland/deno:2.7.6`)

## Commands
- **Test**: `deno test --allow-all` (permission flags required for file I/O tests)
- **Compile**: `deno compile --allow-read --allow-write=./persist.dat --allow-net=0.0.0.0:3000 --allow-env=HOST,PORT,PERSIST,QUEUE_API_TOKEN main.ts`
- **Run**: `deno run --allow-all main.ts` (or with `--persist` flag)
- **Lint**: `deno lint`
- **Format**: `deno fmt`

## Architecture
- `main.ts`: Entry point, env var parsing, server startup
- `src/queue.ts`: Core FIFO Queue<T> class
- `src/manager.ts`: QueueManager - handles multiple named queues, limits, persistence
- `src/handler.ts`: HTTP request handler with auth, rate limiting, routing
- `src/persist.ts`: File-based and no-op persistence implementations
- `src/rate_limiter.ts`: Per-IP rate limiting with cleanup
- `tests/*.ts`: Test suites covering unit, integration, auth, limits, mutation, type safety

## Code Style
- No semicolons preferred
- 4-space indentation
- snake_case for some method names (`is_empty`) alongside camelCase
- Default exports for main classes
- Explicit return types on public methods
- Constructor overloads for Queue class

## Important Notes
- `persist.ts clear()` creates the file if absent (prevents "file not found" errors in tests)
- Deno 2.x-only APIs: `URLPattern`, `Deno.serve()`
- Bearer token auth via `Authorization: Bearer <token>` header
- Health endpoint does NOT require auth
- Rate limiting checks happen BEFORE auth
