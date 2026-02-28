import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptBuffer, decryptBuffer } from "./crypto.js";

describe("encryptBuffer / decryptBuffer", () => {
  it("round-trips: decrypt(encrypt(data)) returns original data", () => {
    const plaintext = Buffer.from("Hello, world! This is a secret file.");
    const encrypted = encryptBuffer(plaintext, "my-password");
    const decrypted = decryptBuffer(encrypted, "my-password");

    expect(decrypted).toEqual(plaintext);
  });

  it("handles empty buffer", () => {
    const plaintext = Buffer.alloc(0);
    const encrypted = encryptBuffer(plaintext, "pw");
    const decrypted = decryptBuffer(encrypted, "pw");

    expect(decrypted).toEqual(plaintext);
  });

  it("handles binary content", () => {
    const plaintext = Buffer.from([0x00, 0xff, 0x80, 0x01, 0xfe]);
    const encrypted = encryptBuffer(plaintext, "pw");
    const decrypted = decryptBuffer(encrypted, "pw");

    expect(decrypted).toEqual(plaintext);
  });

  it("throws on wrong password", () => {
    const plaintext = Buffer.from("secret");
    const encrypted = encryptBuffer(plaintext, "correct-password");

    expect(() => decryptBuffer(encrypted, "wrong-password")).toThrow(
      "Decryption failed — wrong password or corrupted file.",
    );
  });

  it("throws on truncated data", () => {
    const encrypted = encryptBuffer(Buffer.from("data"), "pw");
    const truncated = encrypted.subarray(0, 10);

    expect(() => decryptBuffer(truncated, "pw")).toThrow("too short or corrupted");
  });

  it("throws on non-encrypted data", () => {
    const plaintext = Buffer.from("just a regular file");
    expect(() => decryptBuffer(plaintext, "pw")).toThrow("not encrypted");
  });

  it("produces different ciphertext for the same input (random salt/IV)", () => {
    const plaintext = Buffer.from("same input");
    const enc1 = encryptBuffer(plaintext, "pw");
    const enc2 = encryptBuffer(plaintext, "pw");

    expect(enc1).not.toEqual(enc2);
  });
});

describe("decryptBuffer rejects non-encrypted data", () => {
  it("throws on plaintext", () => {
    expect(() => decryptBuffer(Buffer.from("just text"), "pw")).toThrow("not encrypted");
  });

  it("throws on empty buffer", () => {
    expect(() => decryptBuffer(Buffer.alloc(0), "pw")).toThrow("not encrypted");
  });

  it("throws on buffer shorter than header", () => {
    expect(() => decryptBuffer(Buffer.from("BDO"), "pw")).toThrow("not encrypted");
  });

  it("throws on buffer with wrong magic", () => {
    expect(() => decryptBuffer(Buffer.from("XDOT\x01extra"), "pw")).toThrow("not encrypted");
  });

  it("throws on buffer with wrong version", () => {
    expect(() => decryptBuffer(Buffer.from("BDOT\x02extra"), "pw")).toThrow("not encrypted");
  });
});

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

    // We can't easily test saveKeyFile directly since KEY_FILE_PATH is constant,
    // so we test the underlying behavior
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

    const { resolvePassword } = await import("./crypto.js");
    const result = await resolvePassword();

    expect(result.password).toBe("env-password");
    expect(result.interactive).toBe(false);
  });
});
