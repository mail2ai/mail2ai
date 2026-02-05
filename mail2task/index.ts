/**
 * Mail2AI main entry.
 *
 * Extensible email-driven task processing library.
 * Users can inject their own AI Agent implementation.
 */

import 'dotenv/config';
import { TaskQueue } from './queue/taskQueue.js';
import { EmailMonitor, createEmailMonitor } from './email/emailMonitor.js';
import { EmailService, createEmailService } from './email/emailService.js';
import { Scheduler, createScheduler } from './scheduler/scheduler.js';
import { logger } from './utils/logger.js';
import { IAgent, Task, TaskResult } from './types/index.js';

// Export all modules and types
export { TaskQueue, taskQueue } from './queue/taskQueue.js';
export { EmailMonitor, createEmailMonitor } from './email/emailMonitor.js';
export { EmailService, createEmailService } from './email/emailService.js';
export { Scheduler, createScheduler } from './scheduler/scheduler.js';
export { logger, Logger } from './utils/logger.js';
export * from './types/index.js';

/**
 * Mail2AI configuration options.
 */
export interface Mail2AIConfig {
    /** User-provided Agent implementation (required). */
    agent: IAgent;
    /** Skip email monitoring. */
    skipEmailMonitor?: boolean;
    /** Skip scheduler. */
    skipScheduler?: boolean;
    /** Skip email service. */
    skipEmailService?: boolean;
    /** Task queue file path. */
    taskQueuePath?: string;
    /** Maximum retries. */
    maxRetries?: number;
    /** Scheduler polling interval (ms). */
    pollInterval?: number;
    /** Maximum concurrent tasks. */
    maxConcurrent?: number;
    /** Per-task timeout (ms). */
    taskTimeout?: number;
}

/**
 * Mail2AI application instance.
 *
 * Manages the lifecycle of all services.
 *
 * @example
 * ```typescript
 * import { Mail2AI, IAgent, Task, TaskResult } from 'mail2ai';
 *
 * class MyAgent implements IAgent {
 *   name = 'MyAgent';
 *   async processTask(task: Task): Promise<TaskResult> {
 *     return { summary: 'Processed!' };
 *   }
 * }
 *
 * const app = new Mail2AI({ agent: new MyAgent() });
 * await app.start();
 * ```
 */
export class Mail2AI {
    private taskQueue: TaskQueue;
    private emailMonitor: EmailMonitor | null = null;
    private emailService: EmailService | null = null;
    private agent: IAgent;
    private scheduler: Scheduler | null = null;
    private config: Omit<Mail2AIConfig, 'agent'> & { agent: IAgent };
    private isStarted: boolean = false;

    constructor(config: Mail2AIConfig) {
        if (!config.agent) {
            throw new Error('The agent option is required. Provide an IAgent implementation.');
        }
        
        this.config = config;
        this.agent = config.agent;
        
        // Initialize task queue
        this.taskQueue = new TaskQueue({
            filePath: config.taskQueuePath || process.env.TASK_QUEUE_PATH || './data/tasks.json',
            maxRetries: config.maxRetries || parseInt(process.env.TASK_MAX_RETRIES || '3', 10)
        });
    }

    /**
     * Start all services.
     */
    async start(): Promise<void> {
        if (this.isStarted) {
            logger.warn('Mail2AI is already running.');
            return;
        }

        logger.info('Starting Mail2AI...');
        logger.info(`Using Agent: ${this.agent.name || 'Unknown'}`);

        try {
            // Check Agent readiness
            if (this.agent.isReady) {
                const ready = await this.agent.isReady();
                if (!ready) {
                    throw new Error('Agent is not ready.');
                }
            }

            // Initialize task queue
            await this.taskQueue.initialize();

            // Initialize email service
            if (!this.config.skipEmailService) {
                try {
                    this.emailService = createEmailService();
                    await this.emailService.verify();
                } catch (error) {
                    logger.warn('Email service initialization failed; reports will be disabled.', error);
                    this.emailService = null;
                }
            }

            // Initialize email monitor
            if (!this.config.skipEmailMonitor) {
                try {
                    this.emailMonitor = createEmailMonitor(this.taskQueue);
                    this.emailMonitor.start();
                } catch (error) {
                    logger.warn('Email monitor initialization failed; incoming mail will be disabled.', error);
                    this.emailMonitor = null;
                }
            }

            // Initialize scheduler
            if (!this.config.skipScheduler) {
                this.scheduler = new Scheduler(
                    this.taskQueue,
                    this.agent,
                    this.emailService,
                    {
                        pollInterval: this.config.pollInterval || parseInt(process.env.SCHEDULER_POLL_INTERVAL || '5000', 10),
                        maxConcurrent: this.config.maxConcurrent || parseInt(process.env.SCHEDULER_MAX_CONCURRENT || '1', 10),
                        taskTimeout: this.config.taskTimeout || parseInt(process.env.SCHEDULER_TASK_TIMEOUT || '300000', 10),
                        enabled: true
                    }
                );
                this.scheduler.start();
            }

            this.isStarted = true;
            logger.success('Mail2AI started successfully.');

        } catch (error) {
            logger.error('Mail2AI failed to start', error);
            await this.stop();
            throw error;
        }
    }

    /**
     * Stop all services.
     */
    async stop(): Promise<void> {
        logger.info('Stopping Mail2AI...');

        if (this.emailMonitor) {
            this.emailMonitor.stop();
        }

        if (this.scheduler) {
            await this.scheduler.stop();
        }

        if (this.emailService) {
            this.emailService.close();
        }

        // Dispose Agent resources
        if (this.agent.destroy) {
            try {
                await this.agent.destroy();
            } catch (error) {
                logger.warn('Error while disposing Agent', error);
            }
        }

        this.isStarted = false;
        logger.info('Mail2AI stopped.');
    }

    /**
     * Print current status.
     */
    printStatus(): void {
        console.log('\n======================================');
        console.log('          Mail2AI Status');
        console.log('======================================\n');
        
        console.log(`🤖 Agent: ${this.agent.name || 'Unknown'}`);
        
        console.log(`\n📬 Email Monitor: ${this.emailMonitor ? '✅ Running' : '❌ Disabled'}`);
        if (this.emailMonitor) {
            const status = this.emailMonitor.getStatus();
            console.log(`   - Interval: ${status.interval}`);
        }

        console.log(`\n⚙️  Scheduler: ${this.scheduler ? '✅ Running' : '❌ Disabled'}`);
        if (this.scheduler) {
            const status = this.scheduler.getStatus();
            console.log(`   - Poll interval: ${status.pollInterval}ms`);
            console.log(`   - Max concurrency: ${status.maxConcurrent}`);
            console.log(`   - Task timeout: ${status.taskTimeout}ms`);
            console.log(`   - In flight: ${status.processingCount} task(s)`);
        }

        console.log(`\n📧 Email Service: ${this.emailService ? '✅ Connected' : '❌ Not connected'}`);
        
        console.log('\n======================================\n');
    }

    /**
     * Get the task queue instance.
     */
    getTaskQueue(): TaskQueue {
        return this.taskQueue;
    }

    /**
     * Get the Agent instance.
     */
    getAgent(): IAgent {
        return this.agent;
    }

    /**
     * Get the scheduler instance.
     */
    getScheduler(): Scheduler | null {
        return this.scheduler;
    }

    /**
     * Get queue stats.
     */
    async getQueueStats() {
        return this.taskQueue.getStats();
    }

    /**
     * Manually check emails.
     */
    async checkEmails(): Promise<number> {
        if (!this.emailMonitor) {
            throw new Error('Email monitor is not enabled.');
        }
        return this.emailMonitor.checkNewEmails();
    }

    /**
     * Manually trigger task processing.
     */
    async triggerProcess(): Promise<void> {
        if (!this.scheduler) {
            throw new Error('Scheduler is not enabled.');
        }
        await this.scheduler.triggerPoll();
    }

    /**
     * Manually add a task to the queue.
     */
    async addTask(email: {
        subject: string;
        from: string;
        text: string;
        html?: string;
    }): Promise<Task> {
        const emailContent = {
            messageId: `manual-${Date.now()}`,
            subject: email.subject,
            from: {
                address: email.from,
                name: email.from.split('@')[0]
            },
            to: [],
            date: new Date(),
            text: email.text,
            html: email.html
        };
        
        return this.taskQueue.addTask(emailContent, email.from);
    }
}

/**
 * Simple mock Agent implementation (for tests).
 * Users should implement their own IAgent.
 */
export class MockAgent implements IAgent {
    name = 'MockAgent';
    private delay: number;
    private shouldFail: boolean;
    private failRate: number;

    constructor(options: { delay?: number; shouldFail?: boolean; failRate?: number } = {}) {
        this.delay = options.delay || 1000;
        this.shouldFail = options.shouldFail || false;
        this.failRate = options.failRate || 0;
    }

    async processTask(task: Task): Promise<TaskResult> {
        // Simulated processing delay
        await new Promise(resolve => setTimeout(resolve, this.delay));

        // Random failure
        if (this.shouldFail || Math.random() < this.failRate) {
            throw new Error('Simulated processing failure');
        }

        return {
            summary: `Processed email: ${task.prompt.subject}`,
            todos: [
                {
                    id: '1',
                    title: `Process: ${task.prompt.subject}`,
                    status: 'pending',
                    priority: 'medium'
                }
            ],
            response: `Mock Agent processed task ${task.id}`,
            agentLogs: ['Start processing', 'Analyze email content', 'Generate todos', 'Complete processing']
        };
    }

    async isReady(): Promise<boolean> {
        return true;
    }
}

// Default export
export default Mail2AI;
