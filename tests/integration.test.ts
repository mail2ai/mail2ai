#!/usr/bin/env npx tsx
/**
 * Mail2AI integration tests.
 *
 * Scenarios:
 * 1. Basic task processing
 * 2. Concurrent processing
 * 3. Task timeouts
 * 4. Failures and retries
 * 5. Graceful shutdown
 * 6. Agent error handling
 *
 * Run: npm run test:integration
 */

import { Mail2AI, IAgent, Task, TaskResult, TaskQueue, AgentProcessOptions } from '../src/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Test configuration
const TEST_DATA_DIR = './data/test';
const TEST_QUEUE_PATH = `${TEST_DATA_DIR}/integration-test-tasks.json`;

// Test result stats
interface TestResult {
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
}

const testResults: TestResult[] = [];

// Clean test data
async function cleanup() {
    try {
        await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
        // ignore
    }
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
}

// Assertion helpers
function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
    if (actual !== expected) {
        throw new Error(`Assertion failed: ${message}. Expected ${expected}, got ${actual}`);
    }
}

// ============================================
// Test Agent implementations
// ============================================

/**
 * Configurable test Agent.
 */
class TestAgent implements IAgent {
    name: string;
    private processDelay: number;
    private shouldFail: boolean;
    private failAfterMs: number;
    private failCount: number = 0;
    private maxFails: number;
    public processedTasks: Task[] = [];
    private aborted: boolean = false;

    constructor(options: {
        name?: string;
        processDelay?: number;
        shouldFail?: boolean;
        failAfterMs?: number;
        maxFails?: number;
    } = {}) {
        this.name = options.name || 'TestAgent';
        this.processDelay = options.processDelay ?? 100;
        this.shouldFail = options.shouldFail ?? false;
        this.failAfterMs = options.failAfterMs ?? 0;
        this.maxFails = options.maxFails ?? Infinity;
    }

    async processTask(task: Task, options?: AgentProcessOptions): Promise<TaskResult> {
        this.aborted = false;
        
        // Listen for cancellation
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.aborted = true;
            });
        }

        // Simulate processing delay
        const startTime = Date.now();
        while (Date.now() - startTime < this.processDelay) {
            if (this.aborted) {
                throw new Error('Task was cancelled');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Fail after a specified time
        if (this.failAfterMs > 0 && Date.now() - startTime >= this.failAfterMs) {
            throw new Error(`Failed after ${this.failAfterMs}ms of processing`);
        }

        // Simulated failure
        if (this.shouldFail && this.failCount < this.maxFails) {
            this.failCount++;
            throw new Error(`Simulated failure #${this.failCount}`);
        }

        this.processedTasks.push(task);

        return {
            summary: `Processed: ${task.prompt.subject}`,
            todos: [{
                id: '1',
                title: `Complete: ${task.prompt.subject}`,
                status: 'pending',
                priority: 'medium'
            }],
            response: `TestAgent processed task ${task.id}`,
            agentLogs: ['Start processing', 'Processing...', 'Done']
        };
    }

    async isReady(): Promise<boolean> {
        return true;
    }

    reset() {
        this.failCount = 0;
        this.processedTasks = [];
        this.aborted = false;
    }
}

/**
 * Slow Agent (for timeout tests).
 */
class SlowAgent implements IAgent {
    name = 'SlowAgent';
    private processTime: number;
    public wasAborted = false;

    constructor(processTime: number = 10000) {
        this.processTime = processTime;
    }

    async processTask(task: Task, options?: AgentProcessOptions): Promise<TaskResult> {
        this.wasAborted = false;
        
        // Listen for cancellation
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.wasAborted = true;
            });
        }

        const startTime = Date.now();
        while (Date.now() - startTime < this.processTime) {
            if (this.wasAborted) {
                throw new Error('Task was cancelled due to timeout');
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        return { summary: 'Done' };
    }
}

/**
 * Flaky Agent (for retry tests).
 */
class FlakeyAgent implements IAgent {
    name = 'FlakeyAgent';
    private failProbability: number;
    public attempts = 0;

    constructor(failProbability: number = 0.5) {
        this.failProbability = failProbability;
    }

    async processTask(task: Task): Promise<TaskResult> {
        this.attempts++;
        
        if (Math.random() < this.failProbability) {
            throw new Error(`Random failure (attempt #${this.attempts})`);
        }

        return {
            summary: `Processed successfully (attempt #${this.attempts})`,
            todos: []
        };
    }
}

// ============================================
// Test cases
// ============================================

/**
 * Test 1: basic task processing
 */
async function testBasicTaskProcessing() {
    console.log('  📋 Testing basic task processing...');
    
    const agent = new TestAgent({ processDelay: 100 });
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test1.json`,
        pollInterval: 100,
        maxConcurrent: 1
    });

    try {
        await app.start();

        // Add a task
        const task = await app.addTask({
            subject: 'Test task 1',
            from: 'test@example.com',
            text: 'This is a test task'
        });

        assert(task.id !== undefined, 'Task should have an ID');
        assertEqual(task.status, 'pending', 'New task should be pending');

        // Wait for processing to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify result
        const updatedTask = await app.getTaskQueue().getTask(task.id);
        assertEqual(updatedTask?.status, 'completed', 'Task should be completed');
        assert(updatedTask?.result?.summary !== undefined, 'Result summary should exist');
        assertEqual(agent.processedTasks.length, 1, 'Agent should process 1 task');

        await app.stop();
        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

/**
 * Test 2: concurrent task processing
 */
async function testConcurrentTaskProcessing() {
    console.log('  📋 Testing concurrent task processing...');
    
    const agent = new TestAgent({ processDelay: 200 });
    const maxConcurrent = 3;
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test2.json`,
        pollInterval: 50,
        maxConcurrent
    });

    try {
        await app.start();

        // Add multiple tasks
        const taskCount = 5;
        const tasks = [];
        for (let i = 0; i < taskCount; i++) {
            tasks.push(await app.addTask({
                subject: `Concurrent task ${i + 1}`,
                from: 'test@example.com',
                text: `Concurrent test task ${i + 1}`
            }));
        }

        assertEqual(tasks.length, taskCount, `Should add ${taskCount} tasks`);

        // Wait for processing to complete
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Verify all tasks completed
        const stats = await app.getQueueStats();
        assertEqual(stats.completed, taskCount, `All ${taskCount} tasks should complete`);
        assertEqual(agent.processedTasks.length, taskCount, `Agent should process ${taskCount} tasks`);

        await app.stop();
        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

/**
 * Test 3: task timeout handling
 */
async function testTaskTimeout() {
    console.log('  📋 Testing task timeout handling...');
    
    const slowAgent = new SlowAgent(5000); // 5s processing time
    const app = new Mail2AI({
        agent: slowAgent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test3.json`,
        pollInterval: 100,
        maxConcurrent: 1,
        taskTimeout: 500, // 500ms timeout
        maxRetries: 1
    });

    try {
        await app.start();

        // Add a task
        const task = await app.addTask({
            subject: 'Timeout test task',
            from: 'test@example.com',
            text: 'This task should time out'
        });

        // Wait for timeout and retry
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify task failure
        const updatedTask = await app.getTaskQueue().getTask(task.id);
        assertEqual(updatedTask?.status, 'failed', 'Task should fail due to timeout');
        assert(slowAgent.wasAborted, 'Agent should receive cancellation');

        await app.stop();
        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

/**
 * Test 4: task failures and retries
 */
async function testTaskRetry() {
    console.log('  📋 Testing task failures and retries...');
    
    // Fail twice, succeed on third attempt
    const agent = new TestAgent({
        shouldFail: true,
        maxFails: 2,
        processDelay: 50
    });
    
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test4.json`,
        pollInterval: 100,
        maxConcurrent: 1,
        maxRetries: 3
    });

    try {
        await app.start();

        // Add a task
        const task = await app.addTask({
            subject: 'Retry test task',
            from: 'test@example.com',
            text: 'This task should fail twice before succeeding'
        });

        // Wait for retries and success
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify task success
        const updatedTask = await app.getTaskQueue().getTask(task.id);
        assertEqual(updatedTask?.status, 'completed', 'Task should succeed after retries');
        assert(updatedTask?.retries >= 2, 'Task should retry at least 2 times');

        await app.stop();
        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

/**
 * Test 5: max retries
 */
async function testMaxRetries() {
    console.log('  📋 Testing max retries...');
    
    // Always fail
    const agent = new TestAgent({
        shouldFail: true,
        maxFails: Infinity,
        processDelay: 50
    });
    
    const maxRetries = 3;
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test5.json`,
        pollInterval: 100,
        maxConcurrent: 1,
        maxRetries
    });

    try {
        await app.start();

        // Add a task
        const task = await app.addTask({
            subject: 'Always failing task',
            from: 'test@example.com',
            text: 'This task always fails'
        });

        // Wait for all retries
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify final failure
        const updatedTask = await app.getTaskQueue().getTask(task.id);
        assertEqual(updatedTask?.status, 'failed', 'Task should ultimately fail');
        assertEqual(updatedTask?.retries, maxRetries, `Task should retry ${maxRetries} times`);
        assert(updatedTask?.error !== null, 'Error should be set');

        await app.stop();
        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

/**
 * Test 6: graceful shutdown
 */
async function testGracefulShutdown() {
    console.log('  📋 Testing graceful shutdown...');
    
    const agent = new TestAgent({ processDelay: 1000 }); // 1s processing
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test6.json`,
        pollInterval: 50,
        maxConcurrent: 2
    });

    try {
        await app.start();

        // Add multiple tasks
        await app.addTask({
            subject: 'Shutdown test task 1',
            from: 'test@example.com',
            text: 'Task 1'
        });
        await app.addTask({
            subject: 'Shutdown test task 2',
            from: 'test@example.com',
            text: 'Task 2'
        });

        // Wait for tasks to start
        await new Promise(resolve => setTimeout(resolve, 200));

        // Get scheduler status
        const schedulerStatus = app.getScheduler()?.getStatus();
        assert(schedulerStatus?.processingCount > 0, 'There should be tasks in flight');

        // Stop (should wait for in-flight tasks)
        const shutdownStart = Date.now();
        await app.stop();
        const shutdownDuration = Date.now() - shutdownStart;

        // Verify shutdown waited for completion
        assert(shutdownDuration >= 500, 'Shutdown should wait for tasks to finish');

        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

/**
 * Test 7: Agent not ready
 */
async function testAgentNotReady() {
    console.log('  📋 Testing Agent not ready handling...');
    
    const notReadyAgent: IAgent = {
        name: 'NotReadyAgent',
        async processTask(): Promise<TaskResult> {
            return { summary: 'ok' };
        },
        async isReady(): Promise<boolean> {
            return false; // never ready
        }
    };

    const app = new Mail2AI({
        agent: notReadyAgent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test7.json`
    });

    try {
        await app.start();
        throw new Error('Expected an Agent not ready error');
    } catch (error) {
        if (error instanceof Error && error.message.includes('Agent is not ready')) {
            console.log('    ✅ Passed');
            return true;
        }
        throw error;
    }
}

/**
 * Test 8: task queue persistence
 */
async function testQueuePersistence() {
    console.log('  📋 Testing task queue persistence...');
    
    const queuePath = `${TEST_DATA_DIR}/test8.json`;
    
    // Phase 1: add a task
    const agent1 = new TestAgent({ processDelay: 50 });
    const app1 = new Mail2AI({
        agent: agent1,
        skipEmailMonitor: true,
        skipEmailService: true,
        skipScheduler: true, // do not start scheduler
        taskQueuePath: queuePath
    });

    await app1.start();
    
    await app1.addTask({
        subject: 'Persistence test task',
        from: 'test@example.com',
        text: 'This task should be persisted'
    });

    await app1.stop();

    // Phase 2: restart and verify task exists
    const agent2 = new TestAgent({ processDelay: 50 });
    const app2 = new Mail2AI({
        agent: agent2,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: queuePath,
        pollInterval: 100
    });

    await app2.start();

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));

    const stats = await app2.getQueueStats();
    assertEqual(stats.completed, 1, 'Persisted task should be completed');

    await app2.stop();
    console.log('    ✅ Passed');
    return true;
}

/**
 * Test 9: high volume tasks
 */
async function testHighVolumeTasks() {
    console.log('  📋 Testing high volume task processing...');
    
    const agent = new TestAgent({ processDelay: 50 });
    const taskCount = 20;
    const maxConcurrent = 5;
    
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test9.json`,
        pollInterval: 50,
        maxConcurrent
    });

    try {
        await app.start();

        // Add many tasks concurrently
        const addPromises = [];
        for (let i = 0; i < taskCount; i++) {
            addPromises.push(app.addTask({
                subject: `High volume task ${i + 1}`,
                from: 'test@example.com',
                text: `Task content ${i + 1}`
            }));
        }
        await Promise.all(addPromises);

        // Wait for all tasks to complete
        let attempts = 0;
        while (attempts < 50) { // wait up to 5 seconds
            const stats = await app.getQueueStats();
            if (stats.pending === 0 && stats.processing === 0) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        // Verify results
        const stats = await app.getQueueStats();
        assertEqual(stats.completed, taskCount, `All ${taskCount} tasks should complete`);
        assertEqual(agent.processedTasks.length, taskCount, `Agent should process ${taskCount} tasks`);

        await app.stop();
        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

/**
 * Test 10: task logs
 */
async function testTaskLogs() {
    console.log('  📋 Testing task log recording...');
    
    const agent = new TestAgent({ processDelay: 100 });
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,
        skipEmailService: true,
        taskQueuePath: `${TEST_DATA_DIR}/test10.json`,
        pollInterval: 50,
        maxConcurrent: 1
    });

    try {
        await app.start();

        const task = await app.addTask({
            subject: 'Log test task',
            from: 'test@example.com',
            text: 'Testing log recording'
        });

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify logs
        const updatedTask = await app.getTaskQueue().getTask(task.id);
        assert(updatedTask !== null, 'Task should exist');
        assert(updatedTask!.logs.length >= 3, 'There should be multiple log entries');
        
        // Check log content
        const logMessages = updatedTask!.logs.map(l => l.message);
        assert(logMessages.some(m => m.includes('Task created')), 'Should include creation log');
        assert(logMessages.some(m => m.includes('Task processing started')), 'Should include start log');
        assert(logMessages.some(m => m.includes('Task processing completed')), 'Should include completion log');

        await app.stop();
        console.log('    ✅ Passed');
        return true;
    } catch (error) {
        await app.stop();
        throw error;
    }
}

// ============================================
// Test runner
// ============================================

async function runTest(name: string, testFn: () => Promise<boolean>) {
    const startTime = Date.now();
    try {
        await testFn();
        testResults.push({
            name,
            passed: true,
            duration: Date.now() - startTime
        });
    } catch (error) {
        testResults.push({
            name,
            passed: false,
            duration: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
        });
        console.log(`    ❌ Failed: ${error instanceof Error ? error.message : error}`);
    }
}

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║         Mail2AI Integration Test Suite            ║');
    console.log('╚═══════════════════════════════════════════════════╝\n');

    const startTime = Date.now();

    // Clean test data
    console.log('🧹 Cleaning test data...\n');
    await cleanup();

    console.log('🧪 Running tests...\n');

    // Run all tests
    await runTest('Basic task processing', testBasicTaskProcessing);
    await runTest('Concurrent task processing', testConcurrentTaskProcessing);
    await runTest('Task timeout handling', testTaskTimeout);
    await runTest('Task failures and retries', testTaskRetry);
    await runTest('Max retries', testMaxRetries);
    await runTest('Graceful shutdown', testGracefulShutdown);
    await runTest('Agent not ready', testAgentNotReady);
    await runTest('Queue persistence', testQueuePersistence);
    await runTest('High volume tasks', testHighVolumeTasks);
    await runTest('Task logs', testTaskLogs);

    // Print results
    const totalDuration = Date.now() - startTime;
    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;

    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║                   Test Results                     ║');
    console.log('╠═══════════════════════════════════════════════════╣');
    
    for (const result of testResults) {
        const status = result.passed ? '✅ Passed' : '❌ Failed';
        const duration = `${result.duration}ms`.padStart(8);
        console.log(`║ ${status} ${result.name.padEnd(30)} ${duration} ║`);
    }
    
    console.log('╠═══════════════════════════════════════════════════╣');
    console.log(`║ Total: ${passed} passed, ${failed} failed          Time: ${totalDuration}ms`.padEnd(52) + '║');
    console.log('╚═══════════════════════════════════════════════════╝\n');

    // If failures, print details
    if (failed > 0) {
        console.log('❌ Failed test details:\n');
        for (const result of testResults.filter(r => !r.passed)) {
            console.log(`  ${result.name}:`);
            console.log(`    ${result.error}\n`);
        }
    }

    // Clean test data
    console.log('🧹 Cleaning test data...');
    await cleanup();

    // Exit code
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
    console.error('Test run failed:', error);
    process.exit(1);
});
