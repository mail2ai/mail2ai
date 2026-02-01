/**
 * Email monitor module.
 *
 * Uses imapflow to connect to IMAP and watch new messages.
 * Uses mailparser to parse message content.
 * Uses node-cron to schedule periodic checks.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import cron from 'node-cron';
import { EmailContent } from '../types/index.js';
import { TaskQueue } from '../queue/taskQueue.js';
import { logger } from '../utils/logger.js';

interface EmailMonitorConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
    mailbox?: string;
    checkInterval?: string; // cron expression
}

/**
 * Email monitor.
 *
 * Responsibilities:
 * - Periodically check for new messages
 * - Parse message content
 * - Enqueue tasks from emails
 * - Mark processed messages
 */
export class EmailMonitor {
    private config: EmailMonitorConfig;
    private taskQueue: TaskQueue;
    private cronJob: cron.ScheduledTask | null = null;
    private isRunning: boolean = false;
    private client: ImapFlow | null = null;

    constructor(config: EmailMonitorConfig, taskQueue: TaskQueue) {
        this.config = {
            ...config,
            mailbox: config.mailbox || 'INBOX',
            checkInterval: config.checkInterval || '*/5 * * * *' // default: every 5 minutes
        };
        this.taskQueue = taskQueue;
    }

    /**
     * Create an IMAP client.
     */
    private createClient(): ImapFlow {
        return new ImapFlow({
            host: this.config.host,
            port: this.config.port,
            secure: this.config.secure,
            auth: this.config.auth,
            logger: false // disable default logger
        });
    }

    /**
     * Connect to the IMAP server.
     */
    private async connect(): Promise<ImapFlow> {
        const client = this.createClient();
        await client.connect();
        logger.debug(`Connected to IMAP server: ${this.config.host}`);
        return client;
    }

    /**
     * Parse an email into EmailContent.
     */
    private async parseEmail(parsed: ParsedMail, messageId: string): Promise<EmailContent> {
        const from = parsed.from?.value?.[0];
        // Normalize 'to' to an array of address objects
        const toRaw = parsed.to as any;
        const toValue = toRaw?.value ?? (Array.isArray(toRaw) ? toRaw : []);
        const toArray = Array.isArray(toValue) ? toValue : (toValue ? [toValue] : []);

        return {
            messageId,
            subject: parsed.subject || '(No Subject)',
            from: {
                address: from?.address || 'unknown@unknown.com',
                name: from?.name
            },
            to: toArray.map((addr: any) => ({
                address: addr?.address || '',
                name: addr?.name
            })),
            date: parsed.date || new Date(),
            text: parsed.text,
            html: parsed.html || undefined,
            attachments: parsed.attachments?.map(att => ({
                filename: att.filename || 'unnamed',
                contentType: att.contentType,
                size: att.size
            }))
        };
    }

    /**
     * Check and process new emails.
     */
    async checkNewEmails(): Promise<number> {
        if (this.isRunning) {
            logger.debug('Email check is already running; skipping this cycle.');
            return 0;
        }

        this.isRunning = true;
        let processedCount = 0;
        let client: ImapFlow | null = null;

        try {
            client = await this.connect();
            
            // Open mailbox
            const lock = await client.getMailboxLock(this.config.mailbox!);

            try {
                // Search unread messages
                const messagesRaw = await client.search({ seen: false });
                const messages = Array.isArray(messagesRaw) ? messagesRaw : [];
                
                if (messages.length === 0) {
                    logger.debug('No new emails.');
                    return 0;
                }

                logger.info(`Found ${messages.length} unread emails.`);

                // Process each email
                for (const uid of messages) {
                    try {
                        // Fetch message content
                        const message = await client.fetchOne(uid.toString(), {
                            source: true,
                            uid: true
                        }) as any;

                        if (!message || !message.source) {
                            logger.warn(`Unable to fetch message content: UID ${uid}`);
                            continue;
                        }

                        // Parse email
                        const parsed = await simpleParser(message.source);
                        const emailContent = await this.parseEmail(
                            parsed,
                            (message.uid ? message.uid.toString() : uid.toString())
                        );

                        // Enqueue task
                        await this.taskQueue.addTask(
                            emailContent,
                            emailContent.from.address
                        );

                        // Mark as read
                        await client.messageFlagsAdd(uid.toString(), ['\\Seen']);
                        
                        logger.info(`Email processed: ${emailContent.subject}`, {
                            from: emailContent.from.address
                        });

                        processedCount++;
                    } catch (error) {
                        logger.error(`Failed to process email: UID ${uid}`, error);
                    }
                }
            } finally {
                lock.release();
            }
        } catch (error) {
            logger.error('Error while checking emails', error);
            throw error;
        } finally {
            if (client) {
                await client.logout();
            }
            this.isRunning = false;
        }

        return processedCount;
    }

    /**
     * Start email monitoring.
     */
    start(): void {
        if (this.cronJob) {
            logger.warn('Email monitor is already running.');
            return;
        }

        // Validate cron expression
        if (!cron.validate(this.config.checkInterval!)) {
            throw new Error(`Invalid cron expression: ${this.config.checkInterval}`);
        }

        // Create scheduled task
        this.cronJob = cron.schedule(this.config.checkInterval!, async () => {
            try {
                const count = await this.checkNewEmails();
                if (count > 0) {
                    logger.info(`Processed ${count} emails in this run.`);
                }
            } catch (error) {
                logger.error('Email check task failed', error);
            }
        });

        logger.info(`Email monitor started. Interval: ${this.config.checkInterval}`);

        // Check once on startup
        this.checkNewEmails().catch(err => {
            logger.error('Initial email check failed', err);
        });
    }

    /**
     * Stop email monitoring.
     */
    stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info('Email monitor stopped.');
        }
    }

    /**
     * Get monitor status.
     */
    getStatus(): { running: boolean; interval: string } {
        return {
            running: this.cronJob !== null,
            interval: this.config.checkInterval!
        };
    }
}

/**
 * Create an email monitor.
 */
export function createEmailMonitor(taskQueue: TaskQueue): EmailMonitor {
    const config: EmailMonitorConfig = {
        host: process.env.IMAP_HOST || '',
        port: parseInt(process.env.IMAP_PORT || '993', 10),
        secure: process.env.IMAP_SECURE !== 'false',
        auth: {
            user: process.env.IMAP_USER || '',
            pass: process.env.IMAP_PASS || ''
        },
        mailbox: process.env.IMAP_MAILBOX || 'INBOX',
        checkInterval: process.env.EMAIL_CHECK_INTERVAL || '*/5 * * * *'
    };

    // Validate required configuration
    if (!config.host || !config.auth.user || !config.auth.pass) {
        throw new Error('Missing required IMAP configuration. Set IMAP_HOST, IMAP_USER, and IMAP_PASS.');
    }

    return new EmailMonitor(config, taskQueue);
}
