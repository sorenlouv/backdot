import fs from "node:fs";
import fg from "fast-glob";
import { Config } from "./config.js";
import { logger } from "./log.js";

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
export function resolveFiles(config: Config): string[] {
  const unique = [...new Set(config.paths.flatMap(resolveGlob))];

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
