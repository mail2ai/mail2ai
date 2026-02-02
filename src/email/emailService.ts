/**
 * Email delivery service module.
 *
 * Uses Nodemailer to send task result emails.
 * Supports HTML rendering.
 */

import nodemailer from 'nodemailer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Task, TaskResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

// Email service configuration
interface EmailServiceConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
    from?: string;
}

// Email send options
interface SendMailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

/**
 * Email service.
 *
 * Responsibilities:
 * - Send task result emails
 * - Support HTML templates
 * - Handle errors and retries
 */
export class EmailService {
    private transporter: nodemailer.Transporter;
    private config: EmailServiceConfig;

    constructor(config: EmailServiceConfig) {
        this.config = config;
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: config.auth
        });
    }

    /**
     * Verify the email service connection.
     */
    async verify(): Promise<boolean> {
        try {
            await this.transporter.verify();
            logger.info('Email service connection verified.');
            return true;
        } catch (error) {
            logger.error('Email service connection verification failed', error);
            return false;
        }
    }

    /**
     * Send an email.
     */
    async sendMail(options: SendMailOptions): Promise<void> {
        try {
            const info = await this.transporter.sendMail({
                from: this.config.from || `"Mail2AI" <${this.config.auth.user}>`,
                to: options.to,
                subject: options.subject,
                html: options.html,
                text: options.text
            });

            logger.info(`Email sent: ${info.messageId}`, { to: options.to });
        } catch (error) {
            logger.error('Failed to send email', error);
            throw error;
        }
    }

    /**
     * Generate the task report HTML.
     */
    private generateTaskReportHtml(task: Task): string {
        const isSuccess = task.status === 'completed';
        const statusText = isSuccess ? 'Success' : 'Failure';
        const statusClass = isSuccess ? 'success' : 'error';

        // Format todo list
        let todosHtml = '';
        if (task.result?.todos && task.result.todos.length > 0) {
            todosHtml = `
                <h3>📋 Todo List</h3>
                <ul class="todo-list">
                    ${task.result.todos.map(todo => `
                        <li class="todo-item ${todo.priority || 'medium'}">
                            <span class="todo-status ${todo.status}">${this.getStatusEmoji(todo.status)}</span>
                            <span class="todo-title">${todo.title}</span>
                            ${todo.description ? `<p class="todo-desc">${todo.description}</p>` : ''}
                        </li>
                    `).join('')}
                </ul>
            `;
        }

        // Format logs
        let logsHtml = '';
        if (task.logs && task.logs.length > 0) {
            logsHtml = `
                <details>
                    <summary>📝 Processing Logs (${task.logs.length})</summary>
                    <div class="logs">
                        ${task.logs.map(log => `
                            <div class="log-entry ${log.level}">
                                <span class="log-time">${log.timestamp}</span>
                                <span class="log-level">[${log.level.toUpperCase()}]</span>
                                <span class="log-message">${log.message}</span>
                            </div>
                        `).join('')}
                    </div>
                </details>
            `;
        }

        // Agent logs
        let agentLogsHtml = '';
        if (task.result?.agentLogs && task.result.agentLogs.length > 0) {
            agentLogsHtml = `
                <details>
                    <summary>🤖 Agent Logs (${task.result.agentLogs.length})</summary>
                    <div class="agent-logs">
                        ${task.result.agentLogs.map(log => `
                            <div class="agent-log-entry">${log}</div>
                        `).join('')}
                    </div>
                </details>
            `;
        }

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            border-bottom: 2px solid #eee;
            padding-bottom: 20px;
            margin-bottom: 20px;
        }
        .status {
            display: inline-block;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 14px;
        }
        .status.success {
            background-color: #d4edda;
            color: #155724;
        }
        .status.error {
            background-color: #f8d7da;
            color: #721c24;
        }
        h1 {
            margin: 0 0 10px;
            color: #2c3e50;
        }
        h2, h3 {
            color: #34495e;
        }
        .meta {
            color: #666;
            font-size: 14px;
        }
        .summary {
            background: #f8f9fa;
            border-left: 4px solid #007bff;
            padding: 15px 20px;
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
        }
        .error-box {
            background: #fff5f5;
            border-left: 4px solid #dc3545;
            padding: 15px 20px;
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
        }
        .todo-list {
            list-style: none;
            padding: 0;
        }
        .todo-item {
            padding: 12px 15px;
            margin: 8px 0;
            background: #f8f9fa;
            border-radius: 6px;
            border-left: 4px solid #6c757d;
        }
        .todo-item.high {
            border-left-color: #dc3545;
        }
        .todo-item.medium {
            border-left-color: #ffc107;
        }
        .todo-item.low {
            border-left-color: #28a745;
        }
        .todo-status {
            margin-right: 8px;
        }
        .todo-title {
            font-weight: 500;
        }
        .todo-desc {
            margin: 8px 0 0;
            font-size: 14px;
            color: #666;
        }
        details {
            margin: 20px 0;
        }
        summary {
            cursor: pointer;
            padding: 10px;
            background: #e9ecef;
            border-radius: 4px;
            font-weight: 500;
        }
        .logs, .agent-logs {
            margin-top: 10px;
            background: #1e1e1e;
            color: #d4d4d4;
            padding: 15px;
            border-radius: 4px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 12px;
            max-height: 300px;
            overflow-y: auto;
        }
        .log-entry, .agent-log-entry {
            padding: 4px 0;
            border-bottom: 1px solid #333;
        }
        .log-level {
            margin: 0 8px;
        }
        .log-entry.error { color: #f48771; }
        .log-entry.warn { color: #cca700; }
        .log-entry.info { color: #3dc9b0; }
        .log-entry.debug { color: #888; }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            text-align: center;
            color: #999;
            font-size: 12px;
        }
        a {
            color: #007bff;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📧 Task Report</h1>
            <span class="status ${statusClass}">${statusText}</span>
            <div class="meta">
                <p><strong>Task ID:</strong> ${task.id}</p>
                <p><strong>Original Subject:</strong> ${task.prompt.subject}</p>
                <p><strong>Reporter:</strong> ${task.reporterEmail}</p>
                <p><strong>Created At:</strong> ${task.createdAt}</p>
                ${task.completedAt ? `<p><strong>Completed At:</strong> ${task.completedAt}</p>` : ''}
            </div>
        </div>

        ${isSuccess && task.result?.summary ? `
            <div class="summary">
                <h3>📊 Summary</h3>
                <p>${task.result.summary}</p>
            </div>
        ` : ''}

        ${!isSuccess && task.error ? `
            <div class="error-box">
                <h3>❌ Error</h3>
                <p>${task.error}</p>
            </div>
        ` : ''}

        ${task.result?.issueUrl ? `
            <div class="summary">
                <h3>🔗 GitHub Issue</h3>
                <p><a href="${task.result.issueUrl}" target="_blank">${task.result.issueUrl}</a></p>
            </div>
        ` : ''}

        ${todosHtml}

        ${task.result?.response ? `
            <div class="summary">
                <h3>💬 Agent Response</h3>
                <p>${task.result.response}</p>
            </div>
        ` : ''}

        ${agentLogsHtml}
        ${logsHtml}

        <div class="footer">
            <p>This email was generated automatically by Mail2AI | ${new Date().toISOString()}</p>
        </div>
    </div>
</body>
</html>
        `;
    }

    /**
     * Get a status emoji.
     */
    private getStatusEmoji(status: string): string {
        switch (status) {
            case 'completed': return '✅';
            case 'in-progress': return '🔄';
            case 'pending': return '⏳';
            default: return '❓';
        }
    }

    /**
     * Send a task report email.
     */
    async sendTaskReport(task: Task): Promise<void> {
        if (!task.reporterEmail) {
            logger.warn(`Task ${task.id} is missing a report recipient email; skipping send.`);
            return;
        }

        const isSuccess = task.status === 'completed';
        const statusText = isSuccess ? 'Success' : 'Failure';
        const subject = `[Mail2AI] Task Report: [${statusText}] ${task.prompt.subject}`;

        const html = this.generateTaskReportHtml(task);
        
        // Generate plain text version
        const text = `
Task Report
===========

Status: ${statusText}
Task ID: ${task.id}
Original Subject: ${task.prompt.subject}
Reporter: ${task.reporterEmail}
Created At: ${task.createdAt}
${task.completedAt ? `Completed At: ${task.completedAt}` : ''}

${isSuccess && task.result?.summary ? `Summary:\n${task.result.summary}` : ''}
${!isSuccess && task.error ? `Error:\n${task.error}` : ''}
${task.result?.issueUrl ? `GitHub Issue: ${task.result.issueUrl}` : ''}

---
This email was generated automatically by Mail2AI
        `.trim();

        try {
            await this.sendMail({
                to: task.reporterEmail,
                subject,
                html,
                text
            });
            logger.success(`Task report sent to ${task.reporterEmail}`);
        } catch (error) {
            logger.error(`Failed to send task report to ${task.reporterEmail}`, error);
            // Do not throw to avoid disrupting the main flow.
        }
    }

    /**
     * Close the email service.
     */
    close(): void {
        this.transporter.close();
        logger.info('Email service closed.');
    }
}

/**
 * Create an email service instance.
 */
export function createEmailService(): EmailService {
    const config: EmailServiceConfig = {
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '465', 10),
        secure: process.env.SMTP_SECURE !== 'false',
        auth: {
            user: process.env.SMTP_USER || '',
            pass: process.env.SMTP_PASS || ''
        },
        from: process.env.SMTP_FROM
    };

    // Validate required configuration
    if (!config.host || !config.auth.user || !config.auth.pass) {
        throw new Error('Missing required SMTP configuration. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.');
    }

    return new EmailService(config);
}
