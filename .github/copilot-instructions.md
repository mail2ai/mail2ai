# Copilot instructions for this repo

## Big picture (read these files first)

- Core library lives in mail2task/: Mail2AI orchestrates EmailMonitor (IMAP) → TaskQueue (JSON+lock) → Scheduler → IAgent → EmailService (SMTP). See mail2task/index.ts, mail2task/email/emailMonitor.ts, mail2task/queue/taskQueue.ts, mail2task/scheduler/scheduler.ts, mail2task/email/emailService.ts.
- CLI entrypoint is bin/mail2ai.ts (Commander). It dynamically imports @github/copilot-sdk and falls back to MockAgent if absent.
- There is a separate “analysis agent” package under agent/analysis-project-to-build-lib/ for extracting TS modules into libs (ts-morph + Copilot SDK).

## Architecture & data flow

- Incoming email → EmailMonitor parses (imapflow + mailparser) → TaskQueue.addTask() persists to a JSON file with proper-lockfile.
- Scheduler polls queue, invokes IAgent.processTask() with cancellation/timeout, completes/fails tasks, then EmailService sends a rich HTML report.
- TaskQueue is the single source of truth; any changes should preserve atomicUpdate() locking behavior.

## Project conventions

- ESM + NodeNext: import paths include .js extensions in TS (see mail2task/\*). Keep this pattern.
- TypeScript path alias @/_ maps to mail2task/_ in tsconfig.json, but most code uses explicit relative paths.
- Optional dependencies: @github/copilot-sdk is optional and loaded via dynamic import; keep that pattern for optional AI backends.

## Key integration points

- Environment variables configure email and scheduler:
  IMAP_HOST/IMAP_USER/IMAP_PASS/IMAP_PORT/IMAP_SECURE/IMAP_MAILBOX/EMAIL_CHECK_INTERVAL,
  SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_PORT/SMTP_SECURE,
  TASK_QUEUE_PATH, TASK_MAX_RETRIES, SCHEDULER_POLL_INTERVAL, SCHEDULER_MAX_CONCURRENT, SCHEDULER_TASK_TIMEOUT.
- Agent contract is mail2task/types/index.ts (`IAgent`, `Task`, `TaskResult`). Follow this when adding new agent implementations.

## Developer workflows

- Build: npm run build (tsc → dist/). Dev watch: npm run dev (tsx watch mail2task/index.ts).
- Unit tests: npm test (vitest). Integration tests: npm run test:integration (tsx tests/integration.test.ts).
- CLI usage examples live in examples/ and bin/mail2ai.ts.

## Examples & references

- Library usage: examples/as-library.ts and mail2task/README.md.
- Mock workflow: examples/with-mock-agent.ts.
