import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const BACKDOT_DIR = path.join(HOME, ".backdot");

export const CONFIG_PATH = path.join(BACKDOT_DIR, "config.json");
export const KEY_FILE_PATH = path.join(BACKDOT_DIR, "encryption.key");
export const STAGING_DIR = path.join(BACKDOT_DIR, "repo");
export const STAGING_GIT_DIR = path.join(STAGING_DIR, ".git");
export const LOG_DIR = path.join(BACKDOT_DIR, "logs");
export const CLI_LOG_PATH = path.join(LOG_DIR, "cli.log");
export const LAUNCHD_LOG_PATH = path.join(LOG_DIR, "launchd.log");
export const UI_LOG_PATH = path.join(LOG_DIR, "ui.log");

export function machineDir(machine: string): string {
  return path.join(STAGING_DIR, machine);
}
