/**
 * Simple logger utility.
 *
 * Provides a unified log output format.
 */

import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
    level: LogLevel;
    prefix?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

class Logger {
    private level: LogLevel;
    private prefix: string;

    constructor(options: LoggerOptions = { level: 'info' }) {
        this.level = options.level;
        this.prefix = options.prefix || 'Mail2AI';
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
    }

    private formatTimestamp(): string {
        return new Date().toISOString();
    }

    private formatMessage(level: LogLevel, message: string, data?: unknown): string {
        const timestamp = this.formatTimestamp();
        const prefix = `[${this.prefix}]`;
        const levelStr = level.toUpperCase().padEnd(5);
        
        let formattedMessage = `${timestamp} ${prefix} ${levelStr} ${message}`;
        
        if (data !== undefined) {
            formattedMessage += '\n' + JSON.stringify(data, null, 2);
        }
        
        return formattedMessage;
    }

    debug(message: string, data?: unknown): void {
        if (this.shouldLog('debug')) {
            console.log(chalk.gray(this.formatMessage('debug', message, data)));
        }
    }

    info(message: string, data?: unknown): void {
        if (this.shouldLog('info')) {
            console.log(chalk.blue(this.formatMessage('info', message, data)));
        }
    }

    warn(message: string, data?: unknown): void {
        if (this.shouldLog('warn')) {
            console.log(chalk.yellow(this.formatMessage('warn', message, data)));
        }
    }

    error(message: string, data?: unknown): void {
        if (this.shouldLog('error')) {
            console.error(chalk.red(this.formatMessage('error', message, data)));
        }
    }

    success(message: string, data?: unknown): void {
        if (this.shouldLog('info')) {
            console.log(chalk.green(this.formatMessage('info', message, data)));
        }
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    createChild(prefix: string): Logger {
        return new Logger({
            level: this.level,
            prefix: `${this.prefix}:${prefix}`
        });
    }
}

// Export the default logger instance
export const logger = new Logger({
    level: (process.env.LOG_LEVEL as LogLevel) || 'info'
});

export { Logger };
