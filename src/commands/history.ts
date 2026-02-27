import ora from "ora";
import { select } from "@inquirer/prompts";
import { loadConfig } from "../config.js";
import { gitPull, gitLog } from "../git.js";
import { restore } from "./restore.js";
import { logger } from "../log.js";

export async function history(repoUrl?: string): Promise<void> {
  logger.info("Starting history");

  const repository = repoUrl ?? loadConfig().repository;

  const spinner = ora("Fetching backup history").start();
  await gitPull(repository);
  const commits = await gitLog();
  spinner.stop();

  if (commits.length === 0) {
    console.log("\n  No backup history found.\n");
    return;
  }

  const selected = await select({
    message: "Select a backup to restore from:",
    loop: false,
    choices: commits.map((c) => ({
      name: `${c.hash.slice(0, 7)}  ${c.date.split("T")[0]}  ${c.message}`,
      value: c.hash,
    })),
  });

  console.log();
  await restore(repoUrl, selected);
}
