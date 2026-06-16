import ora from "ora";
import { select } from "@inquirer/prompts";
import { loadConfig } from "../config.js";
import { gitPull, gitLog } from "../git.js";
import { resolveGitHubToken, isGitHubRepoUrl } from "../github.js";
import { restore } from "./restore.js";
import { logger } from "../log.js";

export async function history(repoUrl?: string): Promise<void> {
  logger.info("Starting history");

  if (repoUrl && !isGitHubRepoUrl(repoUrl)) {
    throw new Error(
      `history URL must be an HTTPS github.com URL (https://github.com/<owner>/<repo>): ${repoUrl}`,
    );
  }
  const repository = repoUrl ?? loadConfig().repository;
  const token = resolveGitHubToken();

  const spinner = ora("Fetching backup history").start();
  let commits;
  try {
    await gitPull(repository, token);
    commits = await gitLog();
  } catch (err) {
    spinner.fail("Failed to fetch backup history");
    throw err;
  }
  spinner.stop();

  if (commits.length === 0) {
    console.log("\n  No backup history found.\n");
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "Browsing history is interactive.\n" +
        "  Use `restore --commit <sha>` to restore a specific backup non-interactively.",
    );
  }

  const selectedCommitHash = await select({
    message: "Select a backup to restore from:",
    loop: false,
    choices: commits.map((commit) => {
      const dateOnly = commit.date.split("T")[0];
      return {
        name: `${commit.hash.slice(0, 7)}  ${dateOnly}  ${commit.message}`,
        value: commit.hash,
      };
    }),
  });

  console.log();
  await restore({ repoUrl, commit: selectedCommitHash });
}
