import winston from 'winston';
import path from 'path';

const logDir = 'logs';
const errorLogFile = path.join(logDir, 'error.log');
const combinedLogFile = path.join(logDir, 'combined.log');

const logger = winston.createLogger({
  level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'notion-migration' },
  transports: [
    new winston.transports.File({ 
      filename: errorLogFile,
      level: 'warn',
    }),
    new winston.transports.File({ 
      filename: combinedLogFile,
      level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info'
    })
  ]
});

// Si nous ne sommes pas en production, log aussi dans la console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    level: 'info',
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf((info) => {
        return `${info.level}: ${info.message} ${info.fullPath ?? ''}`;
      })
    )
  }));
}

export default logger; 