/**
 * Task scheduler module.
 *
 * Pulls tasks from the queue and processes them.
 * Supports timeouts, concurrency limits, and graceful shutdown.
 */

import { TaskQueue } from '../queue/taskQueue.js';
import { EmailService } from '../email/emailService.js';
import { Task, IAgent } from '../types/index.js';
import { logger } from '../utils/logger.js';

interface SchedulerConfig {
    pollInterval?: number; // polling interval (ms)
    maxConcurrent?: number; // max concurrency
    enabled?: boolean;
    taskTimeout?: number; // per-task timeout (ms)
    gracefulShutdownTimeout?: number; // graceful shutdown timeout (ms)
}

/**
 * Task scheduler.
 *
 * Responsibilities:
 * - Poll the task queue
 * - Invoke the Agent (any IAgent implementation)
 * - Send result emails
 * - Update task status
 * - Enforce task timeouts
 * - Handle concurrent processing
 * - Support graceful shutdown
 */
export class Scheduler {
    private taskQueue: TaskQueue;
    private agent: IAgent;
    private emailService: EmailService | null;
    private config: Required<SchedulerConfig>;
    private isRunning: boolean = false;
    private pollTimer: NodeJS.Timeout | null = null;
    private processingCount: number = 0;
    private processingTasks: Map<string, AbortController> = new Map();
    private shuttingDown: boolean = false;

    constructor(
        taskQueue: TaskQueue,
        agent: IAgent,
        emailService: EmailService | null,
        config: SchedulerConfig = {}
    ) {
        this.taskQueue = taskQueue;
        this.agent = agent;
        this.emailService = emailService;
        this.config = {
            pollInterval: config.pollInterval || 5000,
            maxConcurrent: config.maxConcurrent || 1,
            enabled: config.enabled !== false,
            taskTimeout: config.taskTimeout || 300000, // default: 5 minutes
            gracefulShutdownTimeout: config.gracefulShutdownTimeout || 30000 // default: 30 seconds
        };
    }

    /**
     * Process a single task (with timeout control).
     */
    private async processTask(task: Task): Promise<void> {
        const startTime = Date.now();
        const abortController = new AbortController();
        this.processingTasks.set(task.id, abortController);
        
        logger.info(`Start processing task: ${task.id}`, { subject: task.prompt.subject });

        // Set task timeout
        const timeoutId = setTimeout(() => {
            abortController.abort();
            logger.warn(`Task timed out: ${task.id} after ${this.config.taskTimeout}ms`);
        }, this.config.taskTimeout);

        try {
            // Add processing log
            await this.taskQueue.addTaskLog(task.id, {
                level: 'info',
                message: `Invoking Agent (${this.agent.name || 'Unknown'})...`
            });

            // Process the task with the Agent (with timeout/cancellation)
            const result = await this.agent.processTask(task, {
                timeout: this.config.taskTimeout,
                signal: abortController.signal
            });

            // Check if cancelled
            if (abortController.signal.aborted) {
                throw new Error('Task was cancelled (timeout or shutdown).');
            }

            // Mark task as completed
            await this.taskQueue.completeTask(task.id, result);

            // Fetch the updated task
            const updatedTask = await this.taskQueue.getTask(task.id);
            
            if (updatedTask && this.emailService) {
                // Send result email
                try {
                    await this.emailService.sendTaskReport(updatedTask);
                } catch (emailError) {
                    logger.warn(`Failed to send email report: ${task.id}`, emailError);
                }
            }

            const duration = Date.now() - startTime;
            logger.success(`Task processed successfully: ${task.id} in ${duration}ms`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Mark task as failed
            const failedTask = await this.taskQueue.failTask(task.id, errorMessage);

            // If the task finally failed (no retry), send failure report
            if (failedTask && failedTask.status === 'failed' && this.emailService) {
                try {
                    await this.emailService.sendTaskReport(failedTask);
                } catch (emailError) {
                    logger.warn(`Failed to send failure report email: ${task.id}`, emailError);
                }
            }

            logger.error(`Task processing failed: ${task.id}`, error);
        } finally {
            clearTimeout(timeoutId);
            this.processingTasks.delete(task.id);
        }
    }

    /**
     * Poll and process tasks.
     */
    private async poll(): Promise<void> {
        // If shutting down, do not accept new tasks
        if (this.shuttingDown) {
            return;
        }
        
        // Check concurrency limit
        if (this.processingCount >= this.config.maxConcurrent) {
            logger.debug(`Max concurrency reached (${this.config.maxConcurrent}); skipping poll.`);
            return;
        }

        try {
            // Try to pick a pending task
            const task = await this.taskQueue.pickTask();

            if (task) {
                this.processingCount++;
                logger.debug(`Current concurrency: ${this.processingCount}/${this.config.maxConcurrent}`);

                // Process asynchronously (allow further polling)
                this.processTask(task)
                    .finally(() => {
                        this.processingCount--;
                    });
            }
        } catch (error) {
            logger.error('Error while polling tasks', error);
        }
    }

    /**
     * Start the scheduler.
     */
    start(): void {
        if (!this.config.enabled) {
            logger.warn('Scheduler is disabled.');
            return;
        }

        if (this.isRunning) {
            logger.warn('Scheduler is already running.');
            return;
        }

        this.isRunning = true;
        this.shuttingDown = false;
        logger.info('Scheduler started', {
            pollInterval: `${this.config.pollInterval}ms`,
            maxConcurrent: this.config.maxConcurrent,
            taskTimeout: `${this.config.taskTimeout}ms`,
            agent: this.agent.name || 'Unknown'
        });

        // Run immediately once
        this.poll();

        // Set interval polling
        this.pollTimer = setInterval(() => {
            if (this.isRunning && !this.shuttingDown) {
                this.poll();
            }
        }, this.config.pollInterval);
    }

    /**
     * Stop the scheduler (with graceful shutdown).
     */
    async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }
        
        this.shuttingDown = true;
        this.isRunning = false;

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        // Wait for in-flight tasks to finish
        if (this.processingTasks.size > 0) {
            logger.info(`Waiting for ${this.processingTasks.size} tasks to finish...`);
            
            const waitStart = Date.now();
            while (this.processingTasks.size > 0) {
                if (Date.now() - waitStart > this.config.gracefulShutdownTimeout) {
                    logger.warn('Graceful shutdown timed out; cancelling remaining tasks.');
                    // Cancel all in-flight tasks
                    for (const [taskId, controller] of this.processingTasks) {
                        logger.warn(`Force-cancelling task: ${taskId}`);
                        controller.abort();
                    }
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        logger.info('Scheduler stopped.');
    }

    /**
     * Get scheduler status.
     */
    getStatus(): {
        running: boolean;
        shuttingDown: boolean;
        processingCount: number;
        processingTaskIds: string[];
        pollInterval: number;
        maxConcurrent: number;
        taskTimeout: number;
        agentName: string;
    } {
        return {
            running: this.isRunning,
            shuttingDown: this.shuttingDown,
            processingCount: this.processingCount,
            processingTaskIds: Array.from(this.processingTasks.keys()),
            pollInterval: this.config.pollInterval,
            maxConcurrent: this.config.maxConcurrent,
            taskTimeout: this.config.taskTimeout,
            agentName: this.agent.name || 'Unknown'
        };
    }

    /**
     * Manually trigger a poll.
     */
    async triggerPoll(): Promise<void> {
        if (!this.isRunning) {
            logger.warn('Scheduler is not running; cannot trigger poll.');
            return;
        }
        await this.poll();
    }
}

/**
 * Create a scheduler instance.
 */
export function createScheduler(
    taskQueue: TaskQueue,
    agent: IAgent,
    emailService: EmailService | null
): Scheduler {
    return new Scheduler(taskQueue, agent, emailService, {
        pollInterval: parseInt(process.env.SCHEDULER_POLL_INTERVAL || '5000', 10),
        maxConcurrent: parseInt(process.env.SCHEDULER_MAX_CONCURRENT || '1', 10),
        taskTimeout: parseInt(process.env.SCHEDULER_TASK_TIMEOUT || '300000', 10),
        enabled: process.env.SCHEDULER_ENABLED !== 'false'
    });
}
