/**
 * Global Logger utility for environment-aware log suppression
 * - In 'test' mode: Only outputs ERROR level logs
 * - In 'dev' mode: Outputs INFO and above
 * - In other modes: Outputs INFO and above (default)
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

class Logger {
    private level: LogLevel;
    private prefix: string;

    constructor(prefix: string = '') {
        this.prefix = prefix ? `[${prefix}]` : '';
        // Determine log level based on RUN_ENV
        // - 'dev': INFO and above (local development, default, full logs)
        // - 'test': ERROR only (CI/promptfoo verification, no noise)
        // - 'production': ERROR only (production verification, clean output)
        const runEnv = process.env.RUN_ENV ?? 'dev';
        this.level = (runEnv === 'dev') ? 'INFO' : 'ERROR';
    }

    private shouldLog(logLevel: LogLevel): boolean {
        const levels: Record<LogLevel, number> = {
            ERROR: 0,
            WARN: 1,
            INFO: 2,
            DEBUG: 3,
        };
        return levels[logLevel] <= levels[this.level];
    }

    error(message: string, data?: unknown): void {
        if (this.shouldLog('ERROR')) {
            console.error(`${this.prefix} ${message}`, data ?? '');
        }
    }

    warn(message: string, data?: unknown): void {
        if (this.shouldLog('WARN')) {
            console.warn(`${this.prefix} ${message}`, data ?? '');
        }
    }

    info(message: string, data?: unknown): void {
        if (this.shouldLog('INFO')) {
            console.log(`${this.prefix} ${message}`, data ?? '');
        }
    }

    debug(message: string, data?: unknown): void {
        if (this.shouldLog('DEBUG')) {
            console.log(`${this.prefix} ${message}`, data ?? '');
        }
    }
}

export function createLogger(prefix: string = ''): Logger {
    return new Logger(prefix);
}

export const globalLogger = new Logger('Global');
