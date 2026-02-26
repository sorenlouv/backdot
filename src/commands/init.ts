import fs from "node:fs";
import os from "node:os";
import chalk from "chalk";
import { CONFIG_PATH } from "../config.js";

const TEMPLATE = {
  repository: "git@github.com:USERNAME/backdot-backup.git",
  machine: os.hostname(),
  paths: ["~/.zshrc", "~/.gitconfig"],
};

export function init(): void {
  console.log();
  console.log(chalk.bold("  Welcome to backdot!"));
  console.log();

  // Step 1
  console.log(chalk.bold("  Step 1 — Create a private Git repository"));
  console.log();
  console.log("  If you don't have a backup repo yet, create one:");
  console.log();
  console.log(
    `    GitHub:    ${chalk.cyan("https://github.com/new?name=backdot-backup&visibility=private")}`,
  );
  console.log(`    GitLab:    ${chalk.cyan("https://gitlab.com/projects/new#blank_project")}`);
  console.log(`    Bitbucket: ${chalk.cyan("https://bitbucket.org/repo/create")}`);
  console.log();

  // Step 2
  console.log(chalk.bold(`  Step 2 — Edit ${CONFIG_PATH}`));
  console.log();

  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`  ${chalk.yellow(`${CONFIG_PATH} already exists — skipping creation.`)}`);
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(TEMPLATE, null, 2) + "\n");
    console.log(`  Created ${CONFIG_PATH} with defaults.`);
  }

  console.log("  Open it and set your repository URL and files to back up.");
  console.log();

  // Step 3
  console.log(chalk.bold("  Step 3 — Run your first backup"));
  console.log();
  console.log(`    ${chalk.bold("backdot --backup")}          Run a one-time backup`);
  console.log(`    ${chalk.bold("backdot --schedule")}        Schedule daily backups (macOS)`);
  console.log(`    ${chalk.bold("backdot --status")}          Check which files will be backed up`);
  console.log();
}
