#!/usr/bin/env npx tsx
/**
 * Full example of using Mail2AI as a library.
 *
 * This example shows how to integrate Mail2AI into your app:
 * 1. Implement a custom IAgent
 * 2. Configure email monitoring (tasks triggered by incoming email)
 * 3. Handle task results
 *
 * Run:
 *   npx tsx examples/as-library.ts
 *
 * Or after installing in your project:
 *   npm install mail2ai
 *   import { Mail2AI, IAgent } from 'mail2ai';
 */

// Import from source (dev mode)
// Production: import { Mail2AI, IAgent, Task, TaskResult, AgentProcessOptions, logger } from 'mail2ai';
import { Mail2AI, IAgent, Task, TaskResult, AgentProcessOptions, logger } from '../src/index.js';

/**
 * Example: custom Agent implementation.
 *
 * You can integrate any AI SDK:
 * - OpenAI
 * - Anthropic Claude
 * - Azure OpenAI
 * - Local LLM (Ollama)
 * - Any other AI service
 */
class MyCustomAgent implements IAgent {
    name = 'MyCustomAgent';
    
    /**
     * Core task processing method.
     *
     * @param task - Task to process (email content)
     * @param options - Optional options (cancellation, timeout, etc.)
     * @returns Task result
     */
    async processTask(task: Task, options?: AgentProcessOptions): Promise<TaskResult> {
        console.log(`\n🤖 [${this.name}] Start processing task...`);
        console.log(`   📧 Subject: ${task.prompt.subject}`);
        console.log(`   📬 Reporter: ${task.reporterEmail}`);
        console.log(`   📝 Preview: ${task.prompt.text?.substring(0, 100)}...`);

        // Check for cancellation
        if (options?.signal?.aborted) {
            throw new Error('Task was cancelled');
        }

        // Simulate AI processing (replace with real SDK calls)
        // Example: const response = await openai.chat.completions.create({...});
        
        await this.simulateAIProcessing(2000, options?.signal);

        // Generate todos from email content
        const todos = this.extractTodos(task.prompt.text || '');

        // Generate summary
        const summary = this.generateSummary(task);

        console.log(`   ✅ Done, generated ${todos.length} todos`);

        return {
            summary,
            todos,
            response: 'Successfully analyzed email and extracted tasks',
            agentLogs: [
                `Email received: ${task.prompt.subject}`,
                'Analyzing email content...',
                `Extracted ${todos.length} todos`,
                'Generated task summary'
            ]
        };
    }

    /**
     * Check whether the Agent is ready.
     */
    async isReady(): Promise<boolean> {
        // Check API keys, network connectivity, etc.
        // Example: return !!process.env.OPENAI_API_KEY;
        return true;
    }

    /**
     * Clean up resources.
     */
    async destroy(): Promise<void> {
        console.log(`🔌 [${this.name}] Cleaning up resources...`);
    }

    // ---- Private helper methods ----

    private async simulateAIProcessing(duration: number, signal?: AbortSignal): Promise<void> {
        const startTime = Date.now();
        while (Date.now() - startTime < duration) {
            if (signal?.aborted) {
                throw new Error('Task was cancelled');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    private extractTodos(text: string): Array<{ id: string; title: string; status: 'pending' | 'completed' | 'in-progress'; priority: 'high' | 'medium' | 'low' }> {
        // Simple todo extraction logic (AI should handle this in real use)
        const keywords = ['need', 'please', 'help me', 'check', 'update', 'create', 'fix'];
        const sentences = text.split(/[。.!！?？\n]+/).filter(s => s.trim());
        
        return sentences
            .filter(s => keywords.some(k => s.includes(k)))
            .slice(0, 5)
            .map((s, i) => ({
                id: `todo-${i + 1}`,
                title: s.trim().substring(0, 50),
                status: 'pending' as const,
                priority: (i === 0 ? 'high' : 'medium') as 'high' | 'medium'
            }));
    }

    private generateSummary(task: Task): string {
        return `Received an email from ${task.reporterEmail} about "${task.prompt.subject}" and extracted todos.`;
    }
}

/**
 * Main function - demonstrates the full library flow.
 */
async function main() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║      Mail2AI Library Example - Email-driven Tasks      ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // Create a custom Agent
    const agent = new MyCustomAgent();

    // Check email configuration
    const hasEmailConfig = !!(process.env.IMAP_HOST && process.env.SMTP_HOST);
    
    if (hasEmailConfig) {
        console.log('📧 Email config detected; enabling monitor mode');
        console.log('   New emails will trigger tasks automatically\n');
    } else {
        console.log('⚠️  Email config not found (IMAP_HOST/SMTP_HOST)');
        console.log('   Running in simulated mode\n');
    }

    // Create Mail2AI instance
    const mail2ai = new Mail2AI({
        agent,
        // Enable monitoring only when configured
        skipEmailMonitor: !hasEmailConfig,
        skipEmailService: !hasEmailConfig,
        // Task queue configuration
        taskQueuePath: './data/library-demo-tasks.json',
        // Scheduler configuration
        pollInterval: 3000,      // poll every 3 seconds
        maxConcurrent: 2,        // up to 2 concurrent tasks
        taskTimeout: 60000,      // 60s per task
        maxRetries: 3            // up to 3 retries
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
        await mail2ai.stop();
        console.log('👋 Exited safely');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    try {
        // Start services
        await mail2ai.start();
        
        // Print status
        mail2ai.printStatus();

        if (hasEmailConfig) {
            // ===== Live email mode =====
            console.log('🎧 Listening for new emails...');
            console.log('   Send email to the configured inbox to trigger tasks');
            console.log('   Press Ctrl+C to exit\n');

            // Keep running and wait for emails
            await new Promise(() => {}); // run until terminated

        } else {
            // ===== Simulated demo mode =====
            console.log('📝 Simulated mode: adding demo tasks...\n');

            // Simulate incoming emails
            const demoEmails = [
                {
                    subject: 'Project status update',
                    from: 'pm@company.com',
                    text: 'Please review this week’s status, update the Gantt chart, and notify the team about the sync.'
                },
                {
                    subject: 'Bug fix request #2024',
                    from: 'qa@company.com', 
                    text: 'Users report slow login page loading; please investigate and fix.'
                },
                {
                    subject: 'New feature request discussion',
                    from: 'product@company.com',
                    text: 'We need data export; create related tasks and estimate effort.'
                }
            ];

            for (const email of demoEmails) {
                console.log(`📨 Simulated email received: ${email.subject}`);
                await mail2ai.addTask(email);
            }

            console.log(`\n✅ Added ${demoEmails.length} tasks\n`);

            // Wait for completion
            console.log('⏳ Waiting for task processing...\n');
            
            let attempts = 0;
            const maxAttempts = 30;
            
            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const stats = await mail2ai.getQueueStats();
                
                if (stats.pending === 0 && stats.processing === 0) {
                    console.log('\n🎉 All tasks completed!\n');
                    break;
                }
                
                attempts++;
            }

            // Display results
            await displayResults(mail2ai);

            // Stop services
            await mail2ai.stop();
            console.log('\n✨ Demo complete!');
        }

    } catch (error) {
        console.error('❌ Run failed:', error);
        await mail2ai.stop();
        process.exit(1);
    }
}

/**
 * Display task results.
 */
async function displayResults(mail2ai: Mail2AI): Promise<void> {
    const tasks = await mail2ai.getTaskQueue().getAllTasks();
    
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║                    Task Results                         ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    
    for (const task of tasks) {
        const statusIcons: Record<string, string> = {
            'completed': '✅',
            'failed': '❌',
            'processing': '🔄',
            'pending': '⏳'
        };
        const statusIcon = statusIcons[task.status] || '❓';
        
        console.log(`║ ${statusIcon} ${task.prompt.subject.padEnd(50).substring(0, 50)} ║`);
        
        if (task.result?.summary) {
            console.log(`║    📝 ${task.result.summary.substring(0, 48).padEnd(48)} ║`);
        }
        
        if (task.result?.todos && task.result.todos.length > 0) {
            console.log(`║    📋 Todos: ${task.result.todos.length} item(s)${''.padEnd(33)} ║`);
            for (const todo of task.result.todos.slice(0, 3)) {
                console.log(`║       • ${todo.title.substring(0, 42).padEnd(42)} ║`);
            }
        }
        
        if (task.error) {
            console.log(`║    ⚠️  Error: ${task.error.substring(0, 40).padEnd(39)} ║`);
        }
    }
    
    console.log('╚════════════════════════════════════════════════════════╝');
    
    // Stats
    const stats = await mail2ai.getQueueStats();
    console.log(`\n📊 Stats: Success ${stats.completed} | Failed ${stats.failed} | Pending ${stats.pending}`);
}

// Run main
main().catch(console.error);
