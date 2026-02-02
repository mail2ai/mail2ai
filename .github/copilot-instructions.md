# Copilot instructions for this repo

## Big picture architecture

- Mail-driven task pipeline: EmailMonitor (IMAP) ➜ TaskQueue (JSON + file lock) ➜ Scheduler (polling + timeout) ➜ `IAgent` ➜ EmailService (SMTP). See [src/email/emailMonitor.ts](src/email/emailMonitor.ts), [src/queue/taskQueue.ts](src/queue/taskQueue.ts), [src/scheduler/scheduler.ts](src/scheduler/scheduler.ts), [src/types/index.ts](src/types/index.ts), [src/email/emailService.ts](src/email/emailService.ts).
- Tasks are persisted in a JSON file (default ./data/tasks.json) with atomic updates via `proper-lockfile`; retries and status transitions are managed in `TaskQueue`. See [src/queue/taskQueue.ts](src/queue/taskQueue.ts).
- `Scheduler` enforces max concurrency and per-task timeouts using `AbortController`; it updates task status and optionally triggers result emails. See [src/scheduler/scheduler.ts](src/scheduler/scheduler.ts).
- `IAgent` is pluggable; the optional Copilot SDK is loaded dynamically in the CLI wrapper in [bin/mail2ai.ts](bin/mail2ai.ts).

## Critical workflows

- NEVER write ANY comments in code.
- All markdowns, documents, comments, codes, and others MUST be in English.
- Build: `npm run build` (tsc) output goes to dist/ (ESM, type module). See [package.json](package.json).
- Dev: `npm run dev` (tsx watch). Examples: `npm run example`, `npm run example:library`. See [package.json](package.json) and [examples/](examples/).
- Tests: `npm run test` (vitest) and `npm run test:integration` (tsx). See [tests/integration.test.ts](tests/integration.test.ts) and [tests/taskQueue.test.ts](tests/taskQueue.test.ts).
- CLI: `npm run cli` or `npx mail2ai ...` uses [bin/mail2ai.ts](bin/mail2ai.ts).

## Project-specific conventions

- ESM: imports use explicit `.js` extensions in TS source (e.g., [src/index.ts](src/index.ts)); keep this pattern for new modules.
- Task lifecycle and logs live in the queue; use `TaskQueue` methods (`addTask`, `pickTask`, `completeTask`, `failTask`, `addTaskLog`) instead of editing queue files directly. See [src/queue/taskQueue.ts](src/queue/taskQueue.ts).
- Email parsing normalizes `to` into an array; preserve this behavior when modifying parsing logic. See [src/email/emailMonitor.ts](src/email/emailMonitor.ts).
- Result emails are HTML-rendered via a lightweight template renderer, not a full template engine. See [src/email/emailService.ts](src/email/emailService.ts).

## Integration points

- IMAP via `imapflow`, parsing via `mailparser`, cron scheduling via `node-cron`, SMTP via `nodemailer`. All configuration comes from env vars. See [src/email/emailMonitor.ts](src/email/emailMonitor.ts) and [src/email/emailService.ts](src/email/emailService.ts).
- Optional `@github/copilot-sdk` is loaded dynamically in the CLI; a `MockAgent` is used when unavailable. See [bin/mail2ai.ts](bin/mail2ai.ts).

## Where to look first

- Entry point and public API: [src/index.ts](src/index.ts)
- Core types: [src/types/index.ts](src/types/index.ts)
- Agent implementation: provide your own `IAgent` implementation or use the CLI wrapper.
