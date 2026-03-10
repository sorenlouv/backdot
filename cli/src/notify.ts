import { execFileSync } from "node:child_process";
import { logger } from "./log.js";
import { errorMessage } from "./utils.js";

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sendNotification(title: string, message: string): void {
  if (process.platform !== "darwin") {
    return;
  }

  const escapedMessage = escapeAppleScript(message);
  const escapedTitle = escapeAppleScript(title);

  try {
    execFileSync(
      "osascript",
      [
        "-e",
        `display notification "${escapedMessage}" with title "${escapedTitle}" subtitle "Scheduled backup failed"`,
      ],
      { stdio: "pipe" },
    );
  } catch (err) {
    logger.warn(`Failed to send notification: ${errorMessage(err)}`);
  }
}
