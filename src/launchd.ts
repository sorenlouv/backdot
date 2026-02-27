import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ora from "ora";
import { logger } from "./log.js";
import { errorMessage } from "./utils.js";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LABEL = "com.backdot.daemon";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function getScriptPath(): string {
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(currentDir, "cli.js");
}

function buildPlist(): string {
  const nodePath = process.execPath;
  const scriptPath = getScriptPath();
  const workingDir = path.dirname(scriptPath);
  const logPath = path.join(os.homedir(), ".backdot", "launchd.log");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(scriptPath)}</string>
    <string>--backup</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDir)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;
}

export function isScheduled(): boolean {
  if (!fs.existsSync(PLIST_PATH)) {
    return false;
  }
  try {
    const output = execFileSync("launchctl", ["list", LABEL], { encoding: "utf-8", stdio: "pipe" });
    return output.includes(LABEL);
  } catch {
    return false;
  }
}

export function setupLaunchd(): void {
  const spinner = ora("Installing schedule").start();

  const plistContent = buildPlist();
  const dir = path.dirname(PLIST_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "pipe" });
  } catch {
    // Not loaded, that's fine
  }

  fs.writeFileSync(PLIST_PATH, plistContent);
  logger.info(`Plist written to ${PLIST_PATH}`);

  try {
    execFileSync("launchctl", ["load", PLIST_PATH], { stdio: "pipe" });
    spinner.succeed("Daily backup scheduled (02:00)");
    console.log();
    logger.info("Launchd job loaded");
  } catch (err) {
    const msg = errorMessage(err);
    spinner.fail(`Failed to load launchd job: ${msg}`);
    console.log();
    logger.error(`Failed to load launchd job: ${msg}`);
    throw new Error(`Failed to load launchd job: ${msg}`, { cause: err });
  }
}

export function uninstallLaunchd(): void {
  const spinner = ora("Removing schedule").start();

  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "pipe" });
    logger.info("Launchd job unloaded");
  } catch {
    logger.info("Launchd job was not loaded");
  }

  if (fs.existsSync(PLIST_PATH)) {
    fs.unlinkSync(PLIST_PATH);
    logger.info(`Plist removed: ${PLIST_PATH}`);
  }

  spinner.succeed("Schedule removed");
  console.log();
}
