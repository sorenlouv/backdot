import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { Config } from "./config.js";
import { logger } from "./log.js";

function resolveGitignored(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    logger.warn(`Directory does not exist, skipping: ${dirPath}`);
    return [];
  }

  try {
    const output = execSync("git ls-files --others --ignored --exclude-standard", {
      cwd: dirPath,
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((rel) => path.resolve(dirPath, rel));
  } catch {
    logger.warn(`Failed to list gitignored files in: ${dirPath}`);
    return [];
  }
}

function resolveGlob(pattern: string): string[] {
  try {
    return fg.sync(pattern, { absolute: true, dot: true });
  } catch {
    logger.warn(`Glob pattern failed: ${pattern}`);
    return [];
  }
}

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB

/**
 * Resolve all file entries to absolute paths.
 * Skips entries that fail resolution and logs warnings.
 */
export function resolveFiles(files: Config["files"]): string[] {
  const allFiles: string[] = [];

  for (const dirPath of files.gitignored) {
    allFiles.push(...resolveGitignored(dirPath));
  }

  for (const pattern of files.match) {
    allFiles.push(...resolveGlob(pattern));
  }

  const unique = [...new Set(allFiles)];

  return unique.filter((filePath) => {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        logger.warn(`Not a regular file, skipping: ${filePath}`);
        return false;
      }
      if (stat.size > LARGE_FILE_THRESHOLD) {
        const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
        logger.warn(`Large file (${sizeMB} MB), skipping: ${filePath}`);
        return false;
      }
      return true;
    } catch {
      logger.warn(`File not readable, skipping: ${filePath}`);
      return false;
    }
  });
}
