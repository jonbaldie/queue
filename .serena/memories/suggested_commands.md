# Suggested Commands

## Running the Application
```bash
# Start server
deno run --allow-net --allow-read --allow-write --allow-env main.ts

# Start server with persistence
deno run --allow-net --allow-read --allow-write --allow-env main.ts --persist
```

## Development
```bash
# Run tests
deno test --allow-read --allow-write

# Format code
deno fmt

# Lint code
deno lint
```

## Environment Variables
- `HOST`: Hostname (default: localhost)
- `PORT`: Port (default: 3000)
- `PERSIST`: Directory for persistence (default: CWD)
- `QUEUE_API_TOKEN`: Bearer token for auth (required)
- `QUEUE_DEPTH_LIMIT`: Max messages per queue (default: 10000)
- `QUEUE_COUNT_LIMIT`: Max number of queues (default: 1000)
- `RATE_LIMIT_REQUESTS`: Max requests per minute per IP (default: 100)
