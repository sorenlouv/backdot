import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import winston from "winston";

const LOG_DIR = path.join(os.homedir(), ".backdot");
const LOG_FILE = path.join(LOG_DIR, "backup.log");

let _logger: winston.Logger | undefined;

function getLogger(): winston.Logger {
  if (!_logger) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    _logger = winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(
          ({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`,
        ),
      ),
      transports: [new winston.transports.File({ filename: LOG_FILE })],
    });
  }
  return _logger;
}

export const logger = {
  info: (message: string) => getLogger().info(message),
  warn: (message: string) => getLogger().warn(message),
  error: (message: string) => getLogger().error(message),
};
