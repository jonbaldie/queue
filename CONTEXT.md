# Domain Context

## Glossary

- **Queue**: A named, ordered sequence of items (FIFO data structure).
- **Queue Name**: The identifier of a Queue. A valid Queue Name is non-empty and at most 128 Unicode code points long; over HTTP it arrives percent-encoded and is decoded exactly once. Rules live in `src/queue_name.ts`.
- **Payload**: The arbitrary data object placed onto a Queue.
- **Queue Manager**: The central coordinator that tracks the lifecycles of all Queues and persists their state.
- **Persist Engine**: The storage mechanism for Queue state. Currently modeled as an append-only log.
- **Item Lifecycle**:
  - **Enqueue**: Appending a new payload to the end of a queue.
  - **Dequeue**: Removing and returning the oldest payload from a queue.
  - **Peek**: Inspecting the oldest payload without removing it.
