import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

export const CONFIG_PATH = path.join(os.homedir(), ".backdot.json");

export function expandTilde(pattern: string): string {
  // fast-glob uses "!" for negation patterns — preserve the prefix, expand the rest
  if (pattern.startsWith("!")) {
    return "!" + expandTilde(pattern.slice(1));
  }
  if (pattern.startsWith("~/") || pattern === "~") {
    return path.join(os.homedir(), pattern.slice(1));
  }
  return pattern;
}

const ConfigSchema = z.object({
  repository: z.string().min(1),
  machine: z.string().min(1),
  paths: z
    .array(z.string().min(1).transform(expandTilde))
    .min(1, '"paths" must be a non-empty array'),
  encrypt: z.boolean().optional().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}\n  Run "backdot init" to create it.`);
  }

  let rawJson: string;
  try {
    rawJson = fs.readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    throw new Error(`Failed to read config file: ${CONFIG_PATH}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error(`Invalid JSON in config file: ${CONFIG_PATH}`);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const field = issue.path.length > 0 ? `"${issue.path.join(".")}"` : "config";
      return `  - ${field}: ${issue.message}`;
    });
    throw new Error(`Invalid config in ${CONFIG_PATH}:\n${messages.join("\n")}`);
  }
  return result.data;
}
