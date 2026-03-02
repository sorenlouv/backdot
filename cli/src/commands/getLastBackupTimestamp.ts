import fs from "node:fs";
import { simpleGit } from "simple-git";
import { STAGING_DIR, STAGING_GIT_DIR, CLI_LOG_PATH } from "../paths.js";
import { getCommitUrl } from "../commitUrl.js";

interface LastBackup {
  time: string;
  success: boolean;
  commitUrl: string | null;
}

function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

async function getLastSuccessfulBackup(): Promise<{ date: Date; hash: string } | null> {
  if (!fs.existsSync(STAGING_GIT_DIR)) {
    return null;
  }

  try {
    const git = simpleGit(STAGING_DIR);
    const log = await git.log({ maxCount: 1 });
    if (!log.latest) {
      return null;
    }
    return { date: new Date(log.latest.date), hash: log.latest.hash };
  } catch {
    return null;
  }
}

function getLastFailureAfter(afterDate: Date | null): Date | null {
  let content: string;
  try {
    content = fs.readFileSync(CLI_LOG_PATH, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) {
      continue;
    }

    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[error] /);
    if (!match) {
      continue;
    }

    const errorDate = new Date(match[1].replace(" ", "T"));
    if (afterDate && errorDate <= afterDate) {
      return null;
    }

    return errorDate;
  }

  return null;
}

async function getLastCommitUrl(hash: string): Promise<string | null> {
  try {
    const git = simpleGit(STAGING_DIR);
    const remoteUrl = ((await git.remote(["get-url", "origin"])) ?? "").trim();
    return getCommitUrl(remoteUrl, hash);
  } catch {
    return null;
  }
}

export async function getLastBackupTimestamp(): Promise<void> {
  const lastSuccess = await getLastSuccessfulBackup();
  const lastFailureDate = getLastFailureAfter(lastSuccess?.date ?? null);

  let lastBackup: LastBackup | null = null;

  if (lastFailureDate) {
    const commitUrl = lastSuccess ? await getLastCommitUrl(lastSuccess.hash) : null;
    lastBackup = { time: formatDate(lastFailureDate), success: false, commitUrl };
  } else if (lastSuccess) {
    const commitUrl = await getLastCommitUrl(lastSuccess.hash);
    lastBackup = { time: formatDate(lastSuccess.date), success: true, commitUrl };
  }

  process.stdout.write(JSON.stringify(lastBackup) + "\n");
}
