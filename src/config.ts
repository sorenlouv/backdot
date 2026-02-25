import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

const CONFIG_PATH = path.join(os.homedir(), ".backdot.json");

export function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

const pathList = z.array(z.string().min(1).transform(expandTilde)).optional().default([]);

const ConfigSchema = z
  .object({
    repository: z.string().min(1),
    "files.gitignored": pathList,
    "files.match": pathList,
  })
  .refine((c) => c["files.gitignored"].length > 0 || c["files.match"].length > 0, {
    message: 'At least one of "files.gitignored" or "files.match" must be a non-empty array',
  })
  .transform((c) => ({
    repository: c.repository,
    files: {
      gitignored: c["files.gitignored"],
      match: c["files.match"],
    },
  }));

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    throw new Error(`Failed to read config file: ${CONFIG_PATH}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${CONFIG_PATH}`);
  }

  return ConfigSchema.parse(parsed);
}
