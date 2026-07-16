# Queue Service - Task Completion Checklist

## Before claiming work complete

1. [ ] All tests pass: `deno test --allow-all`
2. [ ] Lint passes: `deno lint`
3. [ ] Code is formatted: `deno fmt`
4. [ ] Tracer bullet / smoke test run (e.g. `deno run --allow-all main.ts` with
       real HTTP requests)
5. [ ] Update issue with notes on what was done
6. [ ] Close the GitHub issue with `gh issue close <number> --comment "..."`

## Before ending an agent session

1. [ ] Commit code changes: `git add -A && git commit -m "..."`
2. [ ] Push code: `git push`
3. [ ] Verify status: `git status` shows "up to date"
4. [ ] Clean up worktree if finished: `git worktree remove <path>`

## For worktree branches

- Branch names should cite GitHub issue number(s) when applicable
- Use `git worktree add -b <branch-name> <path> main`
- Never use `cd` into worktrees — use `workdir` parameter in tools or absolute
  paths
- Clean up with `git worktree remove <path>` when done
