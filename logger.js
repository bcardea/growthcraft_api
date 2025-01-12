import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '../logs');
const API_LOG_FILE = path.join(LOG_DIR, 'api.log');

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

// Format the log message with timestamp
const formatLogMessage = (type, message) => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${type}] ${typeof message === 'object' ? JSON.stringify(message, null, 2) : message}\n`;
};

// Write to log file
const writeToLog = (message) => {
  fs.appendFileSync(API_LOG_FILE, message);
};

// Log levels
export const logger = {
  info: (message) => {
    const logMessage = formatLogMessage('INFO', message);
    console.log(logMessage);
    writeToLog(logMessage);
  },
  error: (message, error) => {
    const logMessage = formatLogMessage('ERROR', {
      message,
      error: error?.message || error,
      stack: error?.stack
    });
    console.error(logMessage);
    writeToLog(logMessage);
  },
  request: (req) => {
    const logMessage = formatLogMessage('REQUEST', {
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent']
      }
    });
    writeToLog(logMessage);
  },
  response: (req, res, data) => {
    const logMessage = formatLogMessage('RESPONSE', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      data: data
    });
    writeToLog(logMessage);
  }
};

// Express middleware to log requests and responses
export const requestLogger = (req, res, next) => {
  logger.request(req);

  // Capture the original res.json to log responses
  const originalJson = res.json;
  res.json = function(data) {
    logger.response(req, res, data);
    return originalJson.call(this, data);
  };

  next();
};
