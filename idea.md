# Mail2AI Design Notes

## Purpose

Mail2AI is a mail-driven automation tool that turns incoming emails into queued tasks and processes them with a pluggable AI agent. The system is built for reliability (persistent queue with locks), observability (task logs), and user feedback (HTML reports via SMTP).

## Key modules

- **EmailMonitor**: polls IMAP for unread messages, parses them, and enqueues tasks.
- **TaskQueue**: stores tasks in a JSON file with atomic updates and retries.
- **Scheduler**: polls for pending tasks, enforces concurrency and timeouts, and updates task status.
- **IAgent**: user-supplied interface for AI processing.
- **EmailService**: renders and sends HTML reports for completed tasks.

## Non-functional goals

- Resilience to process restarts and transient failures.
- Predictable task ordering and concurrency control.
- Clear audit trail through structured task logs.

## References

- https://github.com/postalsys/imapflow
- https://github.com/nodemailer/nodemailer
- https://github.com/nodemailer/mailparser
- https://github.com/kelektiv/node-cron
- https://github.com/slopus/happy


 
