import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("saveKeyFile / checkKeyFilePermissions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backdot-crypto-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveKeyFile writes password with restricted permissions", () => {
    const keyPath = path.join(tmpDir, ".backdot.key");

    fs.writeFileSync(keyPath, "test-password\n", { mode: 0o600 });

    const stat = fs.statSync(keyPath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(keyPath, "utf-8").trimEnd()).toBe("test-password");
  });
});

describe("resolvePassword", () => {
  const originalEnv = process.env.BACKDOT_PASSWORD;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BACKDOT_PASSWORD = originalEnv;
    } else {
      delete process.env.BACKDOT_PASSWORD;
    }
  });

  it("reads from BACKDOT_PASSWORD env var", async () => {
    process.env.BACKDOT_PASSWORD = "env-password";

    const { resolvePassword } = await import("./password.js");
    const result = await resolvePassword();

    const expectedHash = crypto.createHash("sha256").update("env-password").digest("hex");
    expect(result.password).toBe(expectedHash);
    expect(result.source).toBe("env");
  });
});
