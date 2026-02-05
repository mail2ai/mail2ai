# Mail2AI

Mail-driven automation for AI agents with a persistent task queue, timeouts, and reporting. The core library is in mail2task/ and the CLI is in bin/mail2ai.ts.

## Architecture (high level)
EmailMonitor (IMAP) → TaskQueue (JSON + file locks) → Scheduler → IAgent → EmailService (SMTP reports)

Key code references:
- mail2task/index.ts (Mail2AI orchestrator)
- mail2task/queue/taskQueue.ts (persistent queue)
- mail2task/scheduler/scheduler.ts (polling + concurrency)
- mail2task/email/emailMonitor.ts and mail2task/email/emailService.ts

## Quick start
- Install deps: npm install
- Build: npm run build
- Dev watch: npm run dev
- Run CLI: npm run cli -- start

## Examples
- Mock agent demo: examples/with-mock-agent.ts
- Full library usage: examples/as-library.ts

## Tests
- Unit: npm test
- Integration: npm run test:integration

## Configuration (env)
Email + scheduler behavior is controlled by environment variables:
IMAP_HOST, IMAP_USER, IMAP_PASS, IMAP_PORT, IMAP_SECURE, IMAP_MAILBOX, EMAIL_CHECK_INTERVAL,
SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT, SMTP_SECURE,
TASK_QUEUE_PATH, TASK_MAX_RETRIES, SCHEDULER_POLL_INTERVAL, SCHEDULER_MAX_CONCURRENT, SCHEDULER_TASK_TIMEOUT.

## Agent interface
Implement IAgent from mail2task/types/index.ts. The scheduler passes timeout/cancellation via AgentProcessOptions.

## Additional docs
- mail2task/README.md (library usage)
- agent/analysis-project-to-build-lib/README.md (TS extraction agent)