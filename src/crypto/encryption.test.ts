import { describe, it, expect } from "vitest";
import { encrypt, decrypt, deriveKey } from "./encryption.js";

describe("encrypt / decrypt", () => {
  it("round-trips: decrypt(encrypt(data)) returns original data", () => {
    const plaintext = Buffer.from("Hello, world! This is a secret file.");
    const key = deriveKey("my-password");
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(decrypted).toEqual(plaintext);
  });

  it("handles empty buffer", () => {
    const plaintext = Buffer.alloc(0);
    const key = deriveKey("pw");
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(decrypted).toEqual(plaintext);
  });

  it("handles binary content", () => {
    const plaintext = Buffer.from([0x00, 0xff, 0x80, 0x01, 0xfe]);
    const key = deriveKey("pw");
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);

    expect(decrypted).toEqual(plaintext);
  });

  it("throws on wrong password", () => {
    const plaintext = Buffer.from("secret");
    const encrypted = encrypt(plaintext, deriveKey("correct-password"));

    expect(() => decrypt(encrypted, deriveKey("wrong-password"))).toThrow(
      "Decryption failed — wrong password or corrupted data.",
    );
  });

  it("throws on truncated data", () => {
    const encrypted = encrypt(Buffer.from("data"), deriveKey("pw"));
    const truncated = encrypted.subarray(0, 10);

    expect(() => decrypt(truncated, deriveKey("pw"))).toThrow("too short");
  });

  it("throws on empty buffer", () => {
    expect(() => decrypt(Buffer.alloc(0), deriveKey("pw"))).toThrow("too short");
  });

  it("produces different ciphertext for the same input (random salt/IV)", () => {
    const plaintext = Buffer.from("same input");
    const key = deriveKey("pw");
    const enc1 = encrypt(plaintext, key);
    const enc2 = encrypt(plaintext, key);

    expect(enc1).not.toEqual(enc2);
  });

  it("decrypts files encrypted with a different salt (cross-session)", () => {
    const plaintext = Buffer.from("cross-session data");
    const key1 = deriveKey("pw");
    const key2 = deriveKey("pw");
    const encrypted = encrypt(plaintext, key1);

    expect(key1.salt).not.toEqual(key2.salt);
    expect(decrypt(encrypted, key2)).toEqual(plaintext);
  });
});
