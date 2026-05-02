import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export type Logger = {
  filePath: string;
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
};

const isoNow = () => new Date().toISOString();

export const createFileLogger = (input: { logsDir: string }): Logger => {
  if (!existsSync(input.logsDir)) {
    mkdirSync(input.logsDir, { recursive: true });
  }

  const logFilePath = path.join(input.logsDir, 'app.log');

  const write = (level: LogLevel, message: string, details?: unknown) => {
    const line = `[${isoNow()}] [${level.toUpperCase()}] ${message}${
      details ? ` ${JSON.stringify(details)}` : ''
    }`;

    appendFileSync(logFilePath, `${line}\n`);

    if (level === 'error') {
      console.error(line);
      return;
    }

    console.log(line);
  };

  return {
    filePath: logFilePath,
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details),
  };
};
