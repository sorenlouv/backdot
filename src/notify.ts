import { execFileSync } from "node:child_process";
import { logger } from "./log.js";

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sendNotification(title: string, message: string): void {
  if (process.platform !== "darwin") return;

  const escaped = escapeAppleScript(message);
  const titleEscaped = escapeAppleScript(title);

  try {
    execFileSync(
      "osascript",
      [
        "-e",
        `display notification "${escaped}" with title "${titleEscaped}" subtitle "Scheduled backup failed"`,
      ],
      { stdio: "pipe" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to send notification: ${msg}`);
  }
}
