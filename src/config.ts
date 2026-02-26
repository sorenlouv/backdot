import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

export const CONFIG_PATH = path.join(os.homedir(), ".backdot.json");

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
    machine: z.string().min(1),
    paths: pathList,
  })
  .refine((c) => c.paths.length > 0, {
    message: '"paths" must be a non-empty array',
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}\n  Run "backdot --init" to create it.`);
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

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? `"${i.path.join(".")}"` : "config";
      return `  - ${path}: ${i.message}`;
    });
    throw new Error(`Invalid config in ${CONFIG_PATH}:\n${messages.join("\n")}`);
  }
  return result.data;
}
