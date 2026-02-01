/**
 * Scheduler unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Scheduler } from '../src/scheduler/scheduler.js';
import { TaskQueue } from '../src/queue/taskQueue.js';
import { EmailService } from '../src/email/emailService.js';
import { Task, TaskResult, IAgent } from '../src/types/index.js';

const TEST_DATA_DIR = './data/test';
const TEST_QUEUE_PATH = path.join(TEST_DATA_DIR, 'scheduler-test-tasks.json');

class TestAgent implements IAgent {
    name = 'TestAgent';

    async processTask(): Promise<TaskResult> {
        return { summary: 'Processed' };
    }
}

const createMockEmail = (subject: string) => ({
    messageId: 'test-' + Date.now(),
    subject,
    from: { address: 'test@example.com', name: 'Test User' },
    to: [{ address: 'mail2ai@example.com' }],
    date: new Date(),
    text: 'Test email content'
});

describe('Scheduler', () => {
    let taskQueue: TaskQueue;

    beforeEach(async () => {
        await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
        await fs.mkdir(TEST_DATA_DIR, { recursive: true });

        taskQueue = new TaskQueue({
            filePath: TEST_QUEUE_PATH,
            maxRetries: 1
        });
        await taskQueue.initialize();
    });

    afterEach(async () => {
        await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    });

    it('processes a task and sends a report', async () => {
        const agent = new TestAgent();
        const sendTaskReport = vi.fn(async (_task: Task) => undefined);
        const emailService = { sendTaskReport } as unknown as EmailService;

        const scheduler = new Scheduler(taskQueue, agent, emailService, {
            pollInterval: 50,
            maxConcurrent: 1,
            taskTimeout: 1000
        });

        await taskQueue.addTask(createMockEmail('Scheduler test'), 'reporter@example.com');

        scheduler.start();

        await new Promise(resolve => setTimeout(resolve, 200));

        const completed = await taskQueue.getTasksByStatus('completed');
        expect(completed.length).toBe(1);
        expect(sendTaskReport).toHaveBeenCalledTimes(1);

        await scheduler.stop();
    });
});
