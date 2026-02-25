import path from "node:path";
import os from "node:os";
import winston from "winston";

const LOG_FILE = path.join(os.homedir(), ".backdot", "backup.log");

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`),
  ),
  transports: [new winston.transports.File({ filename: LOG_FILE })],
});
