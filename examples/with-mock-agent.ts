#!/usr/bin/env npx tsx
/**
 * Example using MockAgent.
 *
 * Run: npx tsx examples/with-mock-agent.ts
 */

import { Mail2AI, MockAgent } from '../src/index.js';

async function main() {
    console.log('🚀 Starting Mail2AI (using MockAgent)...\n');

    // Create MockAgent (simulated 1s delay)
    const agent = new MockAgent({ delay: 1000 });

    // Create Mail2AI instance
    const app = new Mail2AI({
        agent,
        skipEmailMonitor: true,  // Skip email monitor (no IMAP required)
        skipEmailService: true,  // Skip email service (no SMTP required)
        taskQueuePath: './data/test-tasks.json',
        pollInterval: 2000,      // poll every 2s
        maxConcurrent: 2,        // max 2 concurrent tasks
        taskTimeout: 30000       // 30s timeout
    });

    // Handle shutdown signals
    const shutdown = async () => {
        console.log('\nReceived shutdown signal, closing...');
        await app.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        // Start services
        await app.start();
        app.printStatus();

        // Manually add test tasks
        console.log('📝 Adding test tasks...\n');
        
        await app.addTask({
            subject: 'Project requirements analysis',
            from: 'test@example.com',
            text: 'Please analyze requirements and create a todo list.'
        });

        await app.addTask({
            subject: 'Code review request',
            from: 'developer@example.com',
            text: 'Review PR #123 changes and check for potential issues.'
        });

        await app.addTask({
            subject: 'Documentation update',
            from: 'docs@example.com',
            text: 'Update README to include usage for the new feature.'
        });

        console.log('✅ Added 3 test tasks\n');

        // Show queue status
        const stats = await app.getQueueStats();
        console.log('📊 Queue status:', stats);

        // Wait for task processing
        console.log('\n⏳ Waiting for task processing...\n');
        
        // Poll for task status
        let checkCount = 0;
        const maxChecks = 30; // up to 30 checks
        
        while (checkCount < maxChecks) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const currentStats = await app.getQueueStats();
            console.log(`[${new Date().toISOString()}] Queue status: pending=${currentStats.pending}, processing=${currentStats.processing}, completed=${currentStats.completed}, failed=${currentStats.failed}`);
            
            // Exit when all tasks are done
            if (currentStats.pending === 0 && currentStats.processing === 0) {
                console.log('\n🎉 All tasks completed!\n');
                break;
            }
            
            checkCount++;
        }

        // Fetch all tasks and print results
        const tasks = await app.getTaskQueue().getAllTasks();
        console.log('📋 Task results:');
        for (const task of tasks) {
            console.log(`  - [${task.status.toUpperCase()}] ${task.prompt.subject}`);
            if (task.result?.summary) {
                console.log(`    Summary: ${task.result.summary}`);
            }
            if (task.error) {
                console.log(`    Error: ${task.error}`);
            }
        }

        // Stop services
        await app.stop();
        console.log('\n👋 Example completed!');

    } catch (error) {
        console.error('❌ Run failed:', error);
        process.exit(1);
    }
}

main();
