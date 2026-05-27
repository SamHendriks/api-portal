const winston = require('winston');
const path = require('path');

const { combine, timestamp, colorize, printf, json } = winston.format;

// Format for the console — human readable with colour
const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  printf(({ level, message, timestamp, ...meta }) => {
    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${extra}`;
  })
);

// Format for log files — structured JSON so it can be parsed by log tools
const fileFormat = combine(
  timestamp(),
  json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    }),
    // All logs info and above
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
      format: fileFormat
    }),
    // Only error logs — easy to scan for problems
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
      format: fileFormat
    })
  ]
});

module.exports = logger;
