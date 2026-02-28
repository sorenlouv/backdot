import fs from "node:fs";
import chalk from "chalk";
import { setupLaunchd, uninstallLaunchd } from "../launchd.js";
import { loadConfig } from "../config.js";
import { KEY_FILE_PATH } from "../crypto.js";

function requireMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "Scheduling is only supported on macOS (launchd). Use cron or systemd on Linux.",
    );
  }
}

export function schedule(): void {
  requireMacOS();
  setupLaunchd();

  try {
    const config = loadConfig();
    if (config.encrypt && !fs.existsSync(KEY_FILE_PATH)) {
      console.log(
        chalk.yellow(
          `  Encryption is enabled. Run ${chalk.bold("backdot backup")} once to create ~/.backdot.key,\n` +
            `  or set ${chalk.bold("BACKDOT_PASSWORD")} in your environment.\n`,
        ),
      );
    }
  } catch {
    // Config may not exist yet; ignore
  }
}

export function unschedule(): void {
  requireMacOS();
  uninstallLaunchd();
}
