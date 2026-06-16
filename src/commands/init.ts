import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { CONFIG_PATH } from "../config.js";
import { TOKEN_FILE_PATH } from "../paths.js";

function getMachineName(): string {
  if (process.platform === "darwin") {
    try {
      return execFileSync("scutil", ["--get", "LocalHostName"], {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
    } catch {
      // fall through
    }
  }

  return os.hostname().replace(/\.(local|localdomain)$/, "");
}

const DEFAULT_CONFIG = {
  repository: "https://github.com/USERNAME/backdot-backup.git",
  machine: getMachineName(),
  paths: ["~/.zshrc", "~/.gitconfig"],
};

export function init(): void {
  console.log();
  console.log(chalk.bold("  Welcome to backdot!"));
  console.log();

  // Step 1
  console.log(chalk.bold("  Step 1 — Create a private GitHub repository"));
  console.log();
  console.log("  If you don't have a backup repo yet, create one:");
  console.log();
  console.log(`    ${chalk.cyan("https://github.com/new?name=backdot-backup&visibility=private")}`);
  console.log();

  // Step 2
  console.log(chalk.bold("  Step 2 — Create a GitHub access token"));
  console.log();
  console.log("  backdot authenticates over HTTPS with a fine-grained personal access token.");
  console.log("  Create one with access to your backup repo (Contents: read and write):");
  console.log();
  console.log(`    ${chalk.cyan("https://github.com/settings/personal-access-tokens")}`);
  console.log();
  console.log(`  Save it to ${chalk.bold(TOKEN_FILE_PATH)} with owner-only permissions:`);
  console.log();
  console.log(`    ${chalk.bold(`umask 077 && printf %s "<token>" > ${TOKEN_FILE_PATH}`)}`);
  console.log();
  console.log(`  (Or set the ${chalk.bold("BACKDOT_GITHUB_TOKEN")} environment variable instead.)`);
  console.log();

  // Step 3
  console.log(chalk.bold(`  Step 3 — Edit ${CONFIG_PATH}`));
  console.log();

  if (fs.existsSync(CONFIG_PATH)) {
    console.log(`  ${chalk.yellow(`${CONFIG_PATH} already exists — skipping creation.`)}`);
  } else {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    console.log(`  Created ${CONFIG_PATH} with defaults.`);
  }

  console.log("  Open it and set your repository URL and the files to back up.");
  console.log(`  To encrypt backups, add ${chalk.bold('"encrypt": true')} to the config.`);
  console.log();

  // Step 4
  console.log(chalk.bold("  Step 4 — Run your first backup"));
  console.log();
  console.log(`    ${chalk.bold("backdot backup")}            Run a one-time backup`);
  console.log(`    ${chalk.bold("backdot schedule")}          Schedule daily backups (macOS)`);
  console.log(`    ${chalk.bold("backdot status")}            Check which files will be backed up`);
  console.log();
}
