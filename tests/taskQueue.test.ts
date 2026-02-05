/**
 * TaskQueue unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TaskQueue } from '../mail2task/queue/taskQueue.js';
import { EmailContent } from '../mail2task/types/index.js';

const TEST_QUEUE_PATH = './data/test-tasks.json';

describe('TaskQueue', () => {
    let taskQueue: TaskQueue;

    beforeEach(async () => {
        // Ensure test file does not exist
        try {
            await fs.unlink(TEST_QUEUE_PATH);
        } catch {
            // File does not exist
        }

        taskQueue = new TaskQueue({
            filePath: TEST_QUEUE_PATH,
            maxRetries: 3
        });
    });

    afterEach(async () => {
        // Clean up test file
        try {
            await fs.unlink(TEST_QUEUE_PATH);
        } catch {
            // File does not exist
        }
    });

    const createMockEmail = (subject: string = 'Test Subject'): EmailContent => ({
        messageId: 'test-' + Date.now(),
        subject,
        from: { address: 'test@example.com', name: 'Test User' },
        to: [{ address: 'mail2ai@example.com' }],
        date: new Date(),
        text: 'Test email content'
    });

    describe('initialize', () => {
        it('should create queue file if not exists', async () => {
            await taskQueue.initialize();
            
            const exists = await fs.access(TEST_QUEUE_PATH).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        });

        it('should load existing queue file', async () => {
            // Create a pre-existing file
            await fs.mkdir(path.dirname(TEST_QUEUE_PATH), { recursive: true });
            await fs.writeFile(TEST_QUEUE_PATH, JSON.stringify({
                tasks: [],
                lastUpdated: new Date().toISOString()
            }));

            await taskQueue.initialize();
            const stats = await taskQueue.getStats();
            expect(stats.total).toBe(0);
        });
    });

    describe('addTask', () => {
        it('should add a new task to the queue', async () => {
            const email = createMockEmail();
            const task = await taskQueue.addTask(email, 'reporter@example.com');

            expect(task.id).toBeDefined();
            expect(task.status).toBe('pending');
            expect(task.prompt.subject).toBe(email.subject);
            expect(task.reporterEmail).toBe('reporter@example.com');
        });

        it('should assign unique IDs to tasks', async () => {
            const task1 = await taskQueue.addTask(createMockEmail('Task 1'), 'a@example.com');
            const task2 = await taskQueue.addTask(createMockEmail('Task 2'), 'b@example.com');

            expect(task1.id).not.toBe(task2.id);
        });
    });

    describe('pickTask', () => {
        it('should return null when queue is empty', async () => {
            await taskQueue.initialize();
            const task = await taskQueue.pickTask();
            expect(task).toBeNull();
        });

        it('should return pending task and mark as processing', async () => {
            const email = createMockEmail();
            const addedTask = await taskQueue.addTask(email, 'test@example.com');

            const pickedTask = await taskQueue.pickTask();
            
            expect(pickedTask).not.toBeNull();
            expect(pickedTask!.id).toBe(addedTask.id);
            expect(pickedTask!.status).toBe('processing');
            expect(pickedTask!.startedAt).not.toBeNull();
        });

        it('should not pick already processing tasks', async () => {
            await taskQueue.addTask(createMockEmail(), 'test@example.com');
            
            const task1 = await taskQueue.pickTask();
            const task2 = await taskQueue.pickTask();

            expect(task1).not.toBeNull();
            expect(task2).toBeNull();
        });
    });

    describe('completeTask', () => {
        it('should mark task as completed with result', async () => {
            const addedTask = await taskQueue.addTask(createMockEmail(), 'test@example.com');
            await taskQueue.pickTask();

            await taskQueue.completeTask(addedTask.id, {
                summary: 'Task completed successfully',
                todos: []
            });

            const task = await taskQueue.getTask(addedTask.id);
            expect(task!.status).toBe('completed');
            expect(task!.result!.summary).toBe('Task completed successfully');
            expect(task!.completedAt).not.toBeNull();
        });
    });

    describe('failTask', () => {
        it('should retry task if retries not exceeded', async () => {
            const addedTask = await taskQueue.addTask(createMockEmail(), 'test@example.com');
            await taskQueue.pickTask();

            const failedTask = await taskQueue.failTask(addedTask.id, 'Test error');

            expect(failedTask!.status).toBe('pending');
            expect(failedTask!.retries).toBe(1);
        });

        it('should mark as failed when max retries exceeded', async () => {
            const taskQueueLowRetry = new TaskQueue({
                filePath: TEST_QUEUE_PATH,
                maxRetries: 1
            });

            const addedTask = await taskQueueLowRetry.addTask(createMockEmail(), 'test@example.com');
            await taskQueueLowRetry.pickTask();

            const failedTask = await taskQueueLowRetry.failTask(addedTask.id, 'Test error');

            expect(failedTask!.status).toBe('failed');
            expect(failedTask!.error).toBe('Test error');
        });
    });

    describe('getStats', () => {
        it('should return correct statistics', async () => {
            await taskQueue.addTask(createMockEmail('Pending 1'), 'a@example.com');
            await taskQueue.addTask(createMockEmail('Pending 2'), 'b@example.com');
            await taskQueue.pickTask();

            const stats = await taskQueue.getStats();

            expect(stats.total).toBe(2);
            expect(stats.pending).toBe(1);
            expect(stats.processing).toBe(1);
            expect(stats.completed).toBe(0);
            expect(stats.failed).toBe(0);
        });
    });

    describe('cleanup', () => {
        it('should remove old completed tasks', async () => {
            // Add and complete a task
            const task = await taskQueue.addTask(createMockEmail(), 'test@example.com');
            await taskQueue.pickTask();
            await taskQueue.completeTask(task.id, { summary: 'Done' });

            // Clean immediately (maxAge = 0)
            const removed = await taskQueue.cleanup(0);

            expect(removed).toBe(1);
            
            const stats = await taskQueue.getStats();
            expect(stats.total).toBe(0);
        });

        it('should not remove pending tasks', async () => {
            await taskQueue.addTask(createMockEmail(), 'test@example.com');
            
            const removed = await taskQueue.cleanup(0);

            expect(removed).toBe(0);
        });
    });
});
