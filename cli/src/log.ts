import fs from "node:fs";
import winston from "winston";
import { LOG_DIR, CLI_LOG_PATH } from "./paths.js";

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
      transports: [new winston.transports.File({ filename: CLI_LOG_PATH })],
    });
  }
  return _logger;
}

export const logger = {
  info: (message: string) => getLogger().info(message),
  warn: (message: string) => getLogger().warn(message),
  error: (message: string) => getLogger().error(message),
};
