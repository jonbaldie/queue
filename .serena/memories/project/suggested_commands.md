# Queue Service - Suggested Commands

## Testing

```bash
deno test --allow-all                    # Run all tests (required permissions)
```

## Development

```bash
deno run --allow-all main.ts             # Run server without persist
deno run --allow-all main.ts --persist   # Run server with persist
deno fmt                                 # Format code
deno lint                                # Lint code
```

## Building

```bash
deno compile --allow-read --allow-write=./persist.dat --allow-net=0.0.0.0:3000 --allow-env=HOST,PORT,PERSIST,QUEUE_API_TOKEN main.ts
```

## GitHub Issues Workflow

```bash
gh issue list
gh issue view <number> --comments
gh issue create --title="..." --body="..."
gh issue close <number> --comment="..."
```

## Worktree Management

```bash
git worktree add -b <branch> <path> main
git worktree remove <path>
```

## Git

```bash
git branch -a
git log main..<branch> --oneline
git diff main..<branch>
```

## Quality Gates (before merging)

1. `deno test --allow-all` must pass
2. `deno lint` should pass
3. `deno fmt` should be clean
