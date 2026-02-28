import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// Higher N = harder to brute-force but slower to encrypt/decrypt (~300ms).
// 2^17 is the OWASP minimum recommendation for password-based key derivation.
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_PARAMS = {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: 1,
  maxmem: 128 * SCRYPT_N * SCRYPT_R * 2, // must exceed 128*N*r
};
const OVERHEAD = SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;

export interface DerivedKey {
  password: string;
  salt: Buffer;
  key: Buffer;
}

export function deriveKey(password: string, salt?: Buffer): DerivedKey {
  const resolvedSalt = salt ?? crypto.randomBytes(SALT_LENGTH);
  const key = crypto.scryptSync(password, resolvedSalt, KEY_LENGTH, SCRYPT_PARAMS);
  return { password, salt: resolvedSalt, key };
}

function deriveKeyForSalt(derivedKey: DerivedKey, salt: Buffer): Buffer {
  if (derivedKey.salt.equals(salt)) {
    return derivedKey.key;
  }
  return crypto.scryptSync(derivedKey.password, salt, KEY_LENGTH, SCRYPT_PARAMS);
}

export function encrypt(plaintext: Buffer, derivedKey: DerivedKey): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([derivedKey.salt, iv, authTag, ciphertext]);
}

export function decrypt(encrypted: Buffer, derivedKey: DerivedKey): Buffer {
  if (encrypted.length < OVERHEAD) {
    throw new Error("Data is too short to be encrypted content.");
  }

  let offset = 0;
  const salt = encrypted.subarray(offset, (offset += SALT_LENGTH));
  const iv = encrypted.subarray(offset, (offset += IV_LENGTH));
  const authTag = encrypted.subarray(offset, (offset += AUTH_TAG_LENGTH));
  const ciphertext = encrypted.subarray(offset);

  const key = deriveKeyForSalt(derivedKey, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Decryption failed — wrong password or corrupted data.");
  }
}
