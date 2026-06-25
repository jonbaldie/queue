# Queue Service - Task Completion Checklist

## Before claiming work complete
1. [ ] All tests pass: `deno test --allow-all`
2. [ ] Lint passes: `deno lint`
3. [ ] Code is formatted: `deno fmt`
4. [ ] Tracer bullet / smoke test run (e.g. `deno run --allow-all main.ts` with real HTTP requests)
5. [ ] Update issue with notes on what was done
6. [ ] Close the bead with `bd close <id>`

## Before ending an agent session
1. [ ] Commit code changes: `git add -A && git commit -m "..."`
2. [ ] Push beads: `bd dolt push`
3. [ ] Push code: `git push`
4. [ ] Verify status: `git status` shows "up to date"
5. [ ] Clean up worktree if finished: `bd worktree remove .worktrees/<name>`

## For worktree branches
- Branch names should cite bead tracking number(s)
- Use `bd worktree create .worktrees/<name> --branch <branch-name>`
- Never use `cd` into worktrees — use `workdir` parameter in tools or absolute paths
- Clean up with `bd worktree remove .worktrees/<name>` when done
