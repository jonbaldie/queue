# Exploratory testing reports

Each folder holds one exploratory pass: the report, driver scripts, and captured
evidence. Replay scripts run from the repository root.

| Date | Report | Findings |
| --- | --- | --- |
| 2026-09-10 | [2026-09-10-report.md](./2026-09-10-queue/2026-09-10-report.md) | Missing auth challenge (#96), Unicode queue-name length (#95) |
| 2026-09-11 | [whitespace-token-lockout-replay.txt](./2026-09-11-queue/whitespace-token-lockout-replay.txt) | Whitespace-only token lockout (#102) |
| 2026-09-12 | [2026-09-12-report.md](./2026-09-12-queue/2026-09-12-report.md) | Internal-whitespace token lockout (#106) |
| 2026-09-15 | [2026-09-15-report.md](./2026-09-15-queue/2026-09-15-report.md) | Non-ASCII token lockout (#112) |
| 2026-09-18 | [2026-09-18-report.md](./2026-09-18-queue/2026-09-18-report.md) | None |
| 2026-09-19 | [2026-09-19-report.md](./2026-09-19-queue/2026-09-19-report.md) | Docker `--persist` path (#114), snapshot-rewrite data loss (#115), invalid UTF-8 accepted (#116) |
| 2026-09-26 | [2026-09-26-report.md](./2026-09-26-queue/2026-09-26-report.md) | None |
