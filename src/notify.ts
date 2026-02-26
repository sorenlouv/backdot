import { execSync } from "node:child_process";
import { logger } from "./log.js";

export function sendNotification(title: string, message: string): void {
  if (process.platform !== "darwin") return;

  const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const titleEscaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  try {
    execSync(
      `osascript -e 'display notification "${escaped}" with title "${titleEscaped}" subtitle "Scheduled backup failed"'`,
      { stdio: "pipe" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to send notification: ${msg}`);
  }
}
