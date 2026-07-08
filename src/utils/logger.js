import winston from 'winston';
import path from 'node:path';
import fs from 'node:fs';
import config from '../config/index.js';

const logsDir = path.resolve(config.rootDir, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, agent, stack }) => {
  const agentTag = agent ? `[${agent}]` : '';
  return `${ts} ${level.toUpperCase()} ${agentTag} ${stack || message}`;
});

function createLogger(agentName) {
  return winston.createLogger({
    level: config.env === 'development' ? 'debug' : 'info',
    format: combine(errors({ stack: true }), timestamp(), logFormat),
    defaultMeta: { agent: agentName },
    transports: [
      new winston.transports.Console({
        format: combine(colorize(), errors({ stack: true }), timestamp(), logFormat),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, `${agentName}.log`),
        maxsize: 5 * 1024 * 1024,
        maxFiles: 3,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'errors.log'),
        level: 'error',
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5,
      }),
    ],
  });
}

export default createLogger;
