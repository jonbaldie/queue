# Project: Queue Service (jonbaldie/queue)

## Purpose
A lightweight, Deno-powered FIFO queue service with HTTP interface, bearer token authentication, rate limiting, and optional file persistence.

## Tech Stack
- **Runtime**: Deno 2.7.6 (Required)
- **Language**: TypeScript
- **Frameworks/APIs**: Native `Deno.serve`, `URLPattern`, and JSR standard library imports.

## Structure
- `main.ts`: Entry point.
- `src/`: Core logic (handler, manager, queue, persist).
- `tests/`: Deno tests.
- `Dockerfile`: Containerization.
