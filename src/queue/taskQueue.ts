/**
 * Task queue module.
 *
 * Persistent JSON-based task queue inspired by slopus/happy MessageQueue2.
 * Uses proper-lockfile for atomic operations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import { v4 as uuidv4 } from 'uuid';
import { Task, TaskStatus, EmailContent, TaskLog, TaskResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

interface TaskQueueOptions {
    filePath: string;
    maxRetries?: number;
    lockTimeout?: number;
}

interface TaskQueueState {
    tasks: Task[];
    lastUpdated: string;
}

/**
 * Persistent task queue.
 *
 * Features:
 * - Stores tasks in a JSON file
 * - File locks for atomicity
 * - Retry support
 * - Task status management
 */
export class TaskQueue {
    private filePath: string;
    private maxRetries: number;
    private lockTimeout: number;
    private initialized: boolean = false;

    constructor(options: TaskQueueOptions) {
        this.filePath = options.filePath;
        this.maxRetries = options.maxRetries || 3;
        this.lockTimeout = options.lockTimeout || 10000;
    }

    /**
     * Initialize the task queue file.
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true });

        try {
            await fs.access(this.filePath);
        } catch {
            // File does not exist; create initial state
            const initialState: TaskQueueState = {
                tasks: [],
                lastUpdated: new Date().toISOString()
            };
            await fs.writeFile(this.filePath, JSON.stringify(initialState, null, 2));
            logger.info(`Task queue file created: ${this.filePath}`);
        }

        this.initialized = true;
        logger.info('Task queue initialized.');
    }

    /**
     * Atomically update the task queue.
     * Uses file locks for concurrency safety.
     */
    private async atomicUpdate<T>(
        updater: (tasks: Task[]) => { tasks: Task[]; result: T }
    ): Promise<T> {
        await this.initialize();

        let release: (() => Promise<void>) | null = null;
        const maxAttempts = 10;
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                // Acquire file lock (with retries and backoff)
                release = await lockfile.lock(this.filePath, {
                    stale: this.lockTimeout,
                    retries: {
                        retries: 15,
                        factor: 1.5,
                        minTimeout: 50,
                        maxTimeout: 500,
                        randomize: true
                    }
                });

                // Read current state
                const content = await fs.readFile(this.filePath, 'utf-8');
                const state: TaskQueueState = JSON.parse(content);

                // Apply update
                const { tasks, result } = updater(state.tasks);

                // Write updated state
                const newState: TaskQueueState = {
                    tasks,
                    lastUpdated: new Date().toISOString()
                };
                await fs.writeFile(this.filePath, JSON.stringify(newState, null, 2));

                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                // If lock contention, wait and retry
                if (lastError.message.includes('Lock file is already being held')) {
                    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
                    continue;
                }
                
                // Other errors are thrown directly
                throw error;
            } finally {
                // Release file lock
                if (release) {
                    try {
                        await release();
                    } catch {
                        // Ignore lock release errors
                    }
                    release = null;
                }
            }
        }

        // All retries failed
        throw lastError || new Error('Failed to acquire lock after maximum attempts');
    }

    /**
     * Add a new task to the queue.
     */
    async addTask(email: EmailContent, reporterEmail: string): Promise<Task> {
        const now = new Date().toISOString();
        const newTask: Task = {
            id: uuidv4(),
            status: 'pending',
            prompt: email,
            reporterEmail,
            result: null,
            error: null,
            retries: 0,
            maxRetries: this.maxRetries,
            createdAt: now,
            startedAt: null,
            completedAt: null,
            updatedAt: now,
            logs: [{
                timestamp: now,
                level: 'info',
                message: 'Task created'
            }]
        };

        await this.atomicUpdate(tasks => ({
            tasks: [...tasks, newTask],
            result: undefined
        }));

        logger.info(`New task added: ${newTask.id}`, { subject: email.subject });
        return newTask;
    }

    /**
     * Get the next pending task and mark it as processing.
     */
    async pickTask(): Promise<Task | null> {
        return this.atomicUpdate(tasks => {
            const taskIndex = tasks.findIndex(t => t.status === 'pending');
            
            if (taskIndex === -1) {
                return { tasks, result: null };
            }

            const now = new Date().toISOString();
            const task = { ...tasks[taskIndex] };
            task.status = 'processing';
            task.startedAt = now;
            task.updatedAt = now;
            task.logs.push({
                timestamp: now,
                level: 'info',
                message: 'Task processing started'
            });

            const updatedTasks = [...tasks];
            updatedTasks[taskIndex] = task;

            logger.info(`Task picked: ${task.id}`);
            return { tasks: updatedTasks, result: task };
        });
    }

    /**
     * Mark a task as completed.
     */
    async completeTask(taskId: string, result: TaskResult): Promise<void> {
        await this.atomicUpdate(tasks => {
            const taskIndex = tasks.findIndex(t => t.id === taskId);
            
            if (taskIndex === -1) {
                logger.warn(`Task not found: ${taskId}`);
                return { tasks, result: undefined };
            }

            const now = new Date().toISOString();
            const task = { ...tasks[taskIndex] };
            task.status = 'completed';
            task.result = result;
            task.completedAt = now;
            task.updatedAt = now;
            task.logs.push({
                timestamp: now,
                level: 'info',
                message: 'Task processing completed'
            });

            const updatedTasks = [...tasks];
            updatedTasks[taskIndex] = task;

            logger.success(`Task completed: ${taskId}`);
            return { tasks: updatedTasks, result: undefined };
        });
    }

    /**
     * Mark a task as failed.
     */
    async failTask(taskId: string, error: string): Promise<Task | null> {
        return this.atomicUpdate(tasks => {
            const taskIndex = tasks.findIndex(t => t.id === taskId);
            
            if (taskIndex === -1) {
                logger.warn(`Task not found: ${taskId}`);
                return { tasks, result: null };
            }

            const now = new Date().toISOString();
            const task = { ...tasks[taskIndex] };
            task.retries += 1;
            task.updatedAt = now;
            task.logs.push({
                timestamp: now,
                level: 'error',
                message: `Task processing failed: ${error}`
            });

            // Check if retry is allowed
            if (task.retries < task.maxRetries) {
                task.status = 'pending'; // put back in queue
                task.startedAt = null;
                task.logs.push({
                    timestamp: now,
                    level: 'info',
                    message: `Task will retry (${task.retries}/${task.maxRetries})`
                });
                logger.warn(`Task will retry: ${taskId} (${task.retries}/${task.maxRetries})`);
            } else {
                task.status = 'failed';
                task.error = error;
                task.completedAt = now;
                logger.error(`Task failed permanently: ${taskId}`);
            }

            const updatedTasks = [...tasks];
            updatedTasks[taskIndex] = task;

            return { tasks: updatedTasks, result: task };
        });
    }

    /**
     * Get task details.
     */
    async getTask(taskId: string): Promise<Task | null> {
        return this.atomicUpdate(tasks => {
            const task = tasks.find(t => t.id === taskId);
            return { tasks, result: task || null };
        });
    }

    /**
     * Get all tasks.
     */
    async getAllTasks(): Promise<Task[]> {
        return this.atomicUpdate(tasks => ({ tasks, result: tasks }));
    }

    /**
     * Get tasks by status.
     */
    async getTasksByStatus(status: TaskStatus): Promise<Task[]> {
        return this.atomicUpdate(tasks => ({
            tasks,
            result: tasks.filter(t => t.status === status)
        }));
    }

    /**
     * Add a task log entry.
     */
    async addTaskLog(taskId: string, log: Omit<TaskLog, 'timestamp'>): Promise<void> {
        await this.atomicUpdate(tasks => {
            const taskIndex = tasks.findIndex(t => t.id === taskId);
            
            if (taskIndex === -1) {
                return { tasks, result: undefined };
            }

            const now = new Date().toISOString();
            const task = { ...tasks[taskIndex] };
            task.logs.push({
                ...log,
                timestamp: now
            });
            task.updatedAt = now;

            const updatedTasks = [...tasks];
            updatedTasks[taskIndex] = task;

            return { tasks: updatedTasks, result: undefined };
        });
    }

    /**
     * Get queue statistics.
     */
    async getStats(): Promise<{
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    }> {
        const tasks = await this.getAllTasks();
        return {
            total: tasks.length,
            pending: tasks.filter(t => t.status === 'pending').length,
            processing: tasks.filter(t => t.status === 'processing').length,
            completed: tasks.filter(t => t.status === 'completed').length,
            failed: tasks.filter(t => t.status === 'failed').length
        };
    }

    /**
     * Cleanup old completed and failed tasks.
     */
    async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
        const now = Date.now();
        
        return this.atomicUpdate(tasks => {
            const cleanedTasks = tasks.filter(task => {
                if (task.status !== 'completed' && task.status !== 'failed') {
                    return true; // keep unfinished tasks
                }
                
                const completedAt = task.completedAt ? new Date(task.completedAt).getTime() : now;
                return now - completedAt < maxAgeMs;
            });

            const removedCount = tasks.length - cleanedTasks.length;
            if (removedCount > 0) {
                logger.info(`Cleaned up ${removedCount} old tasks`);
            }

            return { tasks: cleanedTasks, result: removedCount };
        });
    }
}

// Export the default queue instance
export const taskQueue = new TaskQueue({
    filePath: process.env.TASK_QUEUE_PATH || './data/tasks.json',
    maxRetries: parseInt(process.env.TASK_MAX_RETRIES || '3', 10)
});
