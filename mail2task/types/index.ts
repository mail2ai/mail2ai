/**
 * Mail2AI core type definitions.
 *
 * This file defines all type interfaces used by the system.
 */

// Task status enum
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Agent interface - implement this to plug in your own AI agent.
 *
 * This is the core abstraction of Mail2AI, allowing any AI SDK:
 * - GitHub Copilot SDK
 * - OpenAI API
 * - Anthropic Claude
 * - Custom implementation
 *
 * @example
 * ```typescript
 * import { IAgent, Task, TaskResult } from 'mail2ai';
 *
 * class MyAgent implements IAgent {
 *   async processTask(task: Task): Promise<TaskResult> {
 *     // Use your chosen AI SDK
 *     return { summary: 'Task completed' };
 *   }
 * }
 * ```
 */
export interface IAgent {
    /**
     * Process a task.
     * @param task Task to process
     * @param options Optional processing options
     * @returns Task result
     */
    processTask(task: Task, options?: AgentProcessOptions): Promise<TaskResult>;
    
    /**
     * Optional: get the Agent name.
     */
    readonly name?: string;
    
    /**
     * Optional: check if the Agent is ready.
     */
    isReady?(): Promise<boolean>;
    
    /**
     * Optional: dispose Agent resources.
     */
    destroy?(): Promise<void>;
}

/**
 * Agent processing options.
 */
export interface AgentProcessOptions {
    /** Processing timeout (ms). */
    timeout?: number;
    /** Cancellation signal. */
    signal?: AbortSignal;
    /** Progress callback. */
    onProgress?: (progress: AgentProgress) => void;
}

/**
 * Agent progress updates.
 */
export interface AgentProgress {
    /** Percentage (0-100). */
    percentage?: number;
    /** Current step. */
    step?: string;
    /** Detailed message. */
    message?: string;
}

// Task priority
export type TaskPriority = 'high' | 'medium' | 'low';

// Email content interface
export interface EmailContent {
    messageId: string;
    subject: string;
    from: {
        address: string;
        name?: string;
    };
    to: Array<{
        address: string;
        name?: string;
    }>;
    date: Date;
    text?: string;
    html?: string;
    attachments?: Array<{
        filename: string;
        contentType: string;
        size: number;
    }>;
}

// Task interface
export interface Task {
    id: string;
    status: TaskStatus;
    prompt: EmailContent;
    reporterEmail: string;
    result: TaskResult | null;
    error: string | null;
    retries: number;
    maxRetries: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    updatedAt: string;
    logs: TaskLog[];
}

// Task result interface
export interface TaskResult {
    issueUrl?: string;
    issueNumber?: number;
    summary?: string;
    todos?: TodoItem[];
    response?: string;
    agentLogs?: string[];
}

// Todo item interface
export interface TodoItem {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'completed';
    priority?: TaskPriority;
    description?: string;
}

// Task log interface
export interface TaskLog {
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
}

// Task queue configuration interface
export interface TaskQueueConfig {
    filePath: string;
    maxRetries: number;
    retryDelay: number;
    lockTimeout: number;
}

// Email configuration interface
export interface EmailConfig {
    imap: {
        host: string;
        port: number;
        secure: boolean;
        auth: {
            user: string;
            pass: string;
        };
    };
    smtp: {
        host: string;
        port: number;
        secure: boolean;
        auth: {
            user: string;
            pass: string;
        };
    };
    checkInterval: string; // cron expression
}

// Copilot agent configuration interface
export interface CopilotAgentConfig {
    systemPrompt: string;
    maxTurns: number;
    timeout: number;
    tools: AgentTool[];
}

// Agent tool interface
export interface AgentTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (params: unknown) => Promise<unknown>;
}

// App configuration interface
export interface AppConfig {
    email: EmailConfig;
    taskQueue: TaskQueueConfig;
    agent?: IAgent; // Agent is optional and provided by the user
    github?: {
        owner: string;
        repo: string;
        token: string;
    };
}

// Queue item interface (inspired by MessageQueue2)
export interface QueueItem<T> {
    id: string;
    data: T;
    priority: TaskPriority;
    createdAt: string;
    attempts: number;
}

// Process result interface
export interface ProcessResult {
    success: boolean;
    taskId: string;
    result?: TaskResult;
    error?: string;
    duration: number;
}
