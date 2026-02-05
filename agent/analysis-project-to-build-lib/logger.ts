/**
 * Logger module for the Analysis Agent.
 * Provides structured logging with levels, timestamps, and file output.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    STEP = 2,
    WARN = 3,
    ERROR = 4
}

export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    data?: unknown;
}

export interface LoggerConfig {
    level?: LogLevel;
    prefix?: string;
    enableConsole?: boolean;
    enableTimestamp?: boolean;
}

export class Logger {
    private entries: LogEntry[] = [];
    private config: Required<LoggerConfig>;

    constructor(config: LoggerConfig = {}) {
        this.config = {
            level: config.level ?? LogLevel.INFO,
            prefix: config.prefix ?? '',
            enableConsole: config.enableConsole ?? true,
            enableTimestamp: config.enableTimestamp ?? true
        };
    }

    private log(level: LogLevel, message: string, data?: unknown): void {
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            data
        };
        this.entries.push(entry);

        if (this.config.enableConsole && level >= this.config.level) {
            this.printToConsole(entry);
        }
    }

    private printToConsole(entry: LogEntry): void {
        const timestamp = this.config.enableTimestamp
            ? chalk.gray(`[${entry.timestamp.toISOString()}] `)
            : '';
        const prefix = this.config.prefix ? `${this.config.prefix} ` : '';

        let levelStr: string;
        let colorFn: (s: string) => string;

        switch (entry.level) {
            case LogLevel.DEBUG:
                levelStr = 'DEBUG';
                colorFn = chalk.gray;
                break;
            case LogLevel.INFO:
                levelStr = 'INFO';
                colorFn = chalk.blue;
                break;
            case LogLevel.STEP:
                levelStr = 'STEP';
                colorFn = chalk.cyan;
                break;
            case LogLevel.WARN:
                levelStr = 'WARN';
                colorFn = chalk.yellow;
                break;
            case LogLevel.ERROR:
                levelStr = 'ERROR';
                colorFn = chalk.red;
                break;
            default:
                levelStr = 'LOG';
                colorFn = chalk.white;
        }

        const levelTag = colorFn(`[${levelStr}]`);
        let output = `${timestamp}${prefix}${levelTag} ${entry.message}`;

        if (entry.data !== undefined) {
            if (typeof entry.data === 'object') {
                output += '\n' + JSON.stringify(entry.data, null, 2);
            } else {
                output += ` ${entry.data}`;
            }
        }

        if (entry.level === LogLevel.ERROR) {
            console.error(output);
        } else {
            console.log(output);
        }
    }

    debug(message: string, data?: unknown): void {
        this.log(LogLevel.DEBUG, message, data);
    }

    info(message: string, data?: unknown): void {
        this.log(LogLevel.INFO, message, data);
    }

    step(message: string, data?: unknown): void {
        this.log(LogLevel.STEP, `\n📋 ${message}`, data);
    }

    warn(message: string, data?: unknown): void {
        this.log(LogLevel.WARN, `⚠️ ${message}`, data);
    }

    error(message: string, data?: unknown): void {
        this.log(LogLevel.ERROR, `❌ ${message}`, data);
    }

    success(message: string, data?: unknown): void {
        console.log(chalk.green(`✅ ${message}`));
        this.log(LogLevel.INFO, `✅ ${message}`, data);
    }

    /**
     * Get all log entries.
     */
    getEntries(): LogEntry[] {
        return [...this.entries];
    }

    /**
     * Get entries filtered by level.
     */
    getEntriesByLevel(level: LogLevel): LogEntry[] {
        return this.entries.filter(e => e.level === level);
    }

    /**
     * Get error entries only.
     */
    getErrors(): LogEntry[] {
        return this.getEntriesByLevel(LogLevel.ERROR);
    }

    /**
     * Clear all log entries.
     */
    clear(): void {
        this.entries = [];
    }

    /**
     * Save logs to a file.
     */
    async saveToFile(filePath: string): Promise<void> {
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

            const logContent = this.entries.map(entry => {
                const timestamp = entry.timestamp.toISOString();
                const levelNames = ['DEBUG', 'INFO', 'STEP', 'WARN', 'ERROR'];
                const level = levelNames[entry.level] || 'LOG';
                let line = `[${timestamp}] [${level}] ${entry.message}`;
                if (entry.data !== undefined) {
                    if (typeof entry.data === 'object') {
                        line += '\n' + JSON.stringify(entry.data, null, 2);
                    } else {
                        line += ` ${entry.data}`;
                    }
                }
                return line;
            }).join('\n');

            await fs.promises.writeFile(filePath, logContent, 'utf-8');
        } catch (error) {
            console.error('Failed to save log file:', error);
        }
    }

    /**
     * Generate a summary report.
     */
    generateSummary(): string {
        const counts = {
            debug: 0,
            info: 0,
            step: 0,
            warn: 0,
            error: 0
        };

        for (const entry of this.entries) {
            switch (entry.level) {
                case LogLevel.DEBUG: counts.debug++; break;
                case LogLevel.INFO: counts.info++; break;
                case LogLevel.STEP: counts.step++; break;
                case LogLevel.WARN: counts.warn++; break;
                case LogLevel.ERROR: counts.error++; break;
            }
        }

        return `
## Log Summary

- Total entries: ${this.entries.length}
- Debug: ${counts.debug}
- Info: ${counts.info}
- Steps: ${counts.step}
- Warnings: ${counts.warn}
- Errors: ${counts.error}

${counts.error > 0 ? '### Errors\n\n' + this.getErrors().map(e => `- ${e.message}`).join('\n') : ''}
`;
    }
}

export default Logger;
