# Mail2AI

Mail-driven automation for AI agents with a persistent task queue, timeouts, and reporting.

## Quick Start

See examples in examples/ directory.

```ts
import { Mail2AI, IAgent, Task, TaskResult } from 'mail2ai';

class MyOpenAIAgent implements IAgent {
    name = 'MyOpenAIAgent';
    
    async processTask(task: Task): Promise<TaskResult> {
        const response = await openai.chat.completions.create({
            model: 'gpt-5',
            messages: [{ role: 'user', content: task.prompt.text }]
        });
        
        return {
            summary: 'task completed successfully',
            response: response.choices[0].message.content
        };
    }
    
    async isReady(): Promise<boolean> {
        return !!process.env.OPENAI_API_KEY;
    }
}

// Create Mail2AI instance
const mail2ai = new Mail2AI({
    agent: new MyOpenAIAgent(),
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

await mail2ai.start();

```

## Architecture

┌─────────────────────────────────────────────────────────┐
│                        Mail2AI                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │EmailMonitor │→ │  TaskQueue  │→ │    Scheduler    │  │
│  │   (IMAP)    │  │   (JSON)    │  │                 │  │
│  └─────────────┘  └─────────────┘  └────────┬────────┘  │
│                                             │           │
│                                   ┌─────────▼─────────┐ │
│                                   │     IAgent        │ │
│                                   └─────────┬─────────┘ │
└─────────────────────────────────────────────┼───────────┘
                                              │
        ┌─────────────────────────────────────┼───────────────────────────┐
        │                                     │                           │
┌───────▼───────┐  ┌──────────────────────────▼─────┐  ┌──────────────────▼────────┐
│   MockAgent   │  │        CopilotAgent            │  │    YourCustomAgent        │
│               │  │  (@github/copilot-sdk)         │  │  (OpenAI/Claude/Ollama)   │
└───────────────┘  └────────────────────────────────┘  └───────────────────────────┘

## License

MIT License

