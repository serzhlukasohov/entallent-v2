import pino, { type Logger } from 'pino';

export interface AppLogger {
  trace(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  fatal(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): AppLogger;
}

class PinoAppLogger implements AppLogger {
  constructor(private readonly logger: Logger) {}

  trace(msg: string, data?: Record<string, unknown>): void {
    this.logger.trace(data ?? {}, msg);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.logger.debug(data ?? {}, msg);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.logger.info(data ?? {}, msg);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.logger.warn(data ?? {}, msg);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.logger.error(data ?? {}, msg);
  }

  fatal(msg: string, data?: Record<string, unknown>): void {
    this.logger.fatal(data ?? {}, msg);
  }

  child(bindings: Record<string, unknown>): AppLogger {
    return new PinoAppLogger(this.logger.child(bindings));
  }
}

export function createLogger(context: string): AppLogger {
  const isDev = process.env['NODE_ENV'] !== 'production';

  const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: { context },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
          },
        }
      : {}),
  });

  return new PinoAppLogger(logger);
}

// NestJS-compatible LoggerService wrapper
export class NestLogger {
  private readonly logger: AppLogger;

  constructor(context: string = 'app') {
    this.logger = createLogger(context);
  }

  log(message: string, context?: string): void {
    this.logger.info(message, context ? { context } : {});
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, context ? { context } : {});
  }

  debug(message: string, context?: string): void {
    this.logger.debug(message, context ? { context } : {});
  }

  verbose(message: string, context?: string): void {
    this.logger.trace(message, context ? { context } : {});
  }
}
