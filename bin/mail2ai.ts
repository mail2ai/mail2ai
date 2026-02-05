#!/usr/bin/env node

/**
 * Mail2AI CLI tool.
 *
 * Provides a command-line interface to manage Mail2AI services.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import 'dotenv/config';
import { Mail2AI, MockAgent, IAgent, Task, TaskResult } from '../mail2task/index.js';
import { TaskQueue } from '../mail2task/queue/taskQueue.js';
import { logger } from '../mail2task/utils/logger.js';

/**
 * Try to load the Copilot SDK and create an Agent.
 */
async function createAgent(): Promise<IAgent> {
    try {
        // Try dynamic import of Copilot SDK
        const { CopilotClient } = await import('@github/copilot-sdk');
        
        // Create Copilot Agent
        return new CopilotAgentWrapper();
    } catch {
        // If Copilot SDK is unavailable, fall back to MockAgent
        console.log(chalk.yellow('Note: @github/copilot-sdk is not installed; using MockAgent'));
        console.log(chalk.gray('Install: npm install @github/copilot-sdk\n'));
        return new MockAgent({ delay: 1000 });
    }
}

/**
 * Copilot Agent wrapper (only used when the SDK is available).
 */
class CopilotAgentWrapper implements IAgent {
    name = 'CopilotAgent';
    private client: any;
    private CopilotClient: any;

    async isReady(): Promise<boolean> {
        try {
            const { CopilotClient } = await import('@github/copilot-sdk');
            this.CopilotClient = CopilotClient;
            this.client = new CopilotClient();
            return true;
        } catch {
            return false;
        }
    }

    async processTask(task: Task): Promise<TaskResult> {
        if (!this.client) {
            const { CopilotClient } = await import('@github/copilot-sdk');
            this.client = new CopilotClient();
        }

        const systemPrompt = 'You are a professional task assistant. Analyze emails and create todos.';
        
        const session = await this.client.createSession({
            model: 'claude-sonnet-4-20250514',
            systemMessage: { mode: 'append', content: systemPrompt },
            streaming: false
        });

        try {
            const prompt = `Process email:\nSubject: ${task.prompt.subject}\nContent: ${task.prompt.text || ''}`;
            const response = await session.sendAndWait({ prompt }, 60000);
            
            return {
                summary: response?.data?.content || 'Processed',
                response: response?.data?.content,
                agentLogs: ['Copilot processing completed']
            };
        } finally {
            await session.destroy().catch(() => {});
        }
    }
}

const program = new Command();

program
    .name('mail2ai')
    .description('Email-driven automation tool for AI agents')
    .version('2.0.0');

// Start command
program
    .command('start')
    .description('Start Mail2AI services')
    .option('--no-email-monitor', 'Disable email monitoring')
    .option('--no-scheduler', 'Disable scheduler')
    .option('--mock', 'Use MockAgent (no Copilot SDK required)')
    .action(async (options) => {
        const spinner = ora('Starting Mail2AI...').start();
        
        try {
            spinner.text = 'Initializing Agent...';
            const agent = options.mock ? new MockAgent({ delay: 1000 }) : await createAgent();
            
            const app = new Mail2AI({
                agent,
                skipEmailMonitor: !options.emailMonitor,
                skipScheduler: !options.scheduler
            });

            // Handle shutdown
            const shutdown = async () => {
                spinner.text = 'Shutting down...';
                await app.stop();
                process.exit(0);
            };

            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);

            await app.start();
            spinner.succeed('Mail2AI started successfully');
            
            app.printStatus();
            
            console.log(chalk.cyan('\nPress Ctrl+C to exit\n'));
            
            // Keep process alive
            await new Promise(() => {});
        } catch (error) {
            spinner.fail('Start failed');
            console.error(chalk.red(error instanceof Error ? error.message : String(error)));
            process.exit(1);
        }
    });

// Check mail command
program
    .command('check-mail')
    .description('Check for new emails now')
    .action(async () => {
        const spinner = ora('Checking new emails...').start();
        
        try {
            const agent = await createAgent();
            const app = new Mail2AI({
                agent,
                skipScheduler: true
            });
            await app.start();
            
            const count = await app.checkEmails();
            spinner.succeed(`Check complete, processed ${count} emails`);
            
            await app.stop();
        } catch (error) {
            spinner.fail('Email check failed');
            console.error(chalk.red(error instanceof Error ? error.message : String(error)));
            process.exit(1);
        }
    });

// Queue status command
program
    .command('status')
    .description('Show task queue status')
    .action(async () => {
        try {
            const taskQueue = new TaskQueue({
                filePath: process.env.TASK_QUEUE_PATH || './data/tasks.json'
            });
            await taskQueue.initialize();
            
            const stats = await taskQueue.getStats();
            
            console.log(chalk.bold('\n📊 Task Queue Status\n'));
            console.log(`  Total:      ${chalk.cyan(stats.total)}`);
            console.log(`  Pending:    ${chalk.yellow(stats.pending)}`);
            console.log(`  Processing: ${chalk.blue(stats.processing)}`);
            console.log(`  Completed:  ${chalk.green(stats.completed)}`);
            console.log(`  Failed:     ${chalk.red(stats.failed)}`);
            console.log();
        } catch (error) {
            console.error(chalk.red('Failed to get status:'), error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

// List tasks command
program
    .command('list')
    .description('List tasks')
    .option('-s, --status <status>', 'Filter by status (pending, processing, completed, failed)')
    .option('-l, --limit <number>', 'Limit results', '10')
    .action(async (options) => {
        try {
            const taskQueue = new TaskQueue({
                filePath: process.env.TASK_QUEUE_PATH || './data/tasks.json'
            });
            await taskQueue.initialize();
            
            let tasks = await taskQueue.getAllTasks();
            
            if (options.status) {
                tasks = tasks.filter(t => t.status === options.status);
            }
            
            const limit = parseInt(options.limit, 10);
            tasks = tasks.slice(-limit);
            
            if (tasks.length === 0) {
                console.log(chalk.yellow('\nNo tasks found\n'));
                return;
            }
            
            console.log(chalk.bold(`\n📋 Task List (showing ${tasks.length} most recent)\n`));
            
            for (const task of tasks) {
                const statusIcon = {
                    pending: '⏳',
                    processing: '🔄',
                    completed: '✅',
                    failed: '❌'
                }[task.status] || '❓';
                
                const statusColor = {
                    pending: chalk.yellow,
                    processing: chalk.blue,
                    completed: chalk.green,
                    failed: chalk.red
                }[task.status] || chalk.gray;
                
                console.log(`  ${statusIcon} ${statusColor(task.status.padEnd(12))} ${chalk.gray(task.id.substring(0, 8))} ${task.prompt.subject}`);
            }
            console.log();
        } catch (error) {
            console.error(chalk.red('Failed to list tasks:'), error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

// Process a single task
program
    .command('process <taskId>')
    .description('Manually process a task')
    .action(async (taskId) => {
        const spinner = ora('Processing task...').start();
        
        try {
            const taskQueue = new TaskQueue({
                filePath: process.env.TASK_QUEUE_PATH || './data/tasks.json'
            });
            await taskQueue.initialize();
            
            // Find task
            let task = await taskQueue.getTask(taskId);
            
            // Support short IDs
            if (!task) {
                const allTasks = await taskQueue.getAllTasks();
                task = allTasks.find(t => t.id.startsWith(taskId)) || null;
            }
            
            if (!task) {
                spinner.fail(`Task not found: ${taskId}`);
                process.exit(1);
            }
            
            spinner.text = `Processing task: ${task.prompt.subject}`;
            
            const agent = await createAgent();
            if (agent.isReady) {
                await agent.isReady();
            }
            const result = await agent.processTask(task);
            
            await taskQueue.completeTask(task.id, result);
            
            spinner.succeed('Task processing completed');
            
            console.log(chalk.bold('\n📋 Result\n'));
            if (result.summary) {
                console.log(chalk.cyan('Summary:'), result.summary);
            }
            if (result.todos && result.todos.length > 0) {
                console.log(chalk.cyan('\nTodos:'));
                for (const todo of result.todos) {
                    const priorityIcon = { high: '🔴', medium: '🟡', low: '🟢' }[todo.priority || 'medium'];
                    console.log(`  ${priorityIcon} ${todo.title}`);
                }
            }
            console.log();
        } catch (error) {
            spinner.fail('Task processing failed');
            console.error(chalk.red(error instanceof Error ? error.message : String(error)));
            process.exit(1);
        }
    });

// Cleanup command
program
    .command('cleanup')
    .description('Clean up old completed and failed tasks')
    .option('-d, --days <number>', 'Keep tasks from the last N days', '7')
    .action(async (options) => {
        const spinner = ora('Cleaning up old tasks...').start();
        
        try {
            const taskQueue = new TaskQueue({
                filePath: process.env.TASK_QUEUE_PATH || './data/tasks.json'
            });
            await taskQueue.initialize();
            
            const days = parseInt(options.days, 10);
            const maxAgeMs = days * 24 * 60 * 60 * 1000;
            
            const removedCount = await taskQueue.cleanup(maxAgeMs);
            
            spinner.succeed(`Cleanup complete, removed ${removedCount} old tasks`);
        } catch (error) {
            spinner.fail('Cleanup failed');
            console.error(chalk.red(error instanceof Error ? error.message : String(error)));
            process.exit(1);
        }
    });

// Test Agent command
program
    .command('test-agent')
    .description('Test AI Agent')
    .option('-m, --message <message>', 'Test message', 'Please create a todo for completing project docs')
    .option('--mock', 'Use MockAgent')
    .action(async (options) => {
        const spinner = ora('Testing Agent...').start();
        
        try {
            const agent = options.mock ? new MockAgent({ delay: 500 }) : await createAgent();
            if (agent.isReady) {
                const ready = await agent.isReady();
                if (!ready) {
                    throw new Error('Agent is not ready');
                }
            }
            
            spinner.text = `Testing with ${agent.name || 'Unknown'} Agent...`;
            
            // Create a mock task
            const mockTask = {
                id: 'test-' + Date.now(),
                status: 'processing' as const,
                prompt: {
                    messageId: 'test',
                    subject: 'Test email',
                    from: { address: 'test@example.com', name: 'Test User' },
                    to: [{ address: 'mail2ai@example.com' }],
                    date: new Date(),
                    text: options.message
                },
                reporterEmail: 'test@example.com',
                result: null,
                error: null,
                retries: 0,
                maxRetries: 3,
                createdAt: new Date().toISOString(),
                startedAt: new Date().toISOString(),
                completedAt: null,
                updatedAt: new Date().toISOString(),
                logs: []
            };
            
            const result = await agent.processTask(mockTask);
            
            spinner.succeed('Agent test completed');
            
            console.log(chalk.bold('\n🤖 Agent Response\n'));
            
            if (result.summary) {
                console.log(chalk.cyan('Summary:'), result.summary);
            }
            
            if (result.todos && result.todos.length > 0) {
                console.log(chalk.cyan('\nTodos:'));
                for (const todo of result.todos) {
                    console.log(`  - ${todo.title} (${todo.priority || 'medium'})`);
                }
            }
            
            if (result.agentLogs && result.agentLogs.length > 0) {
                console.log(chalk.cyan('\nAgent Logs:'));
                for (const log of result.agentLogs) {
                    console.log(chalk.gray(`  ${log}`));
                }
            }
            console.log();
        } catch (error) {
            spinner.fail('Agent test failed');
            console.error(chalk.red(error instanceof Error ? error.message : String(error)));
            process.exit(1);
        }
    });

program.parse();
