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

/** An encryption key derived from the user's password via scrypt. */
export interface DerivedKey {
  passwordHash: string;
  salt: Buffer;
  key: Buffer;
}

export function deriveKey(passwordHash: string, salt?: Buffer): DerivedKey {
  const resolvedSalt = salt ?? crypto.randomBytes(SALT_LENGTH);
  const key = crypto.scryptSync(passwordHash, resolvedSalt, KEY_LENGTH, SCRYPT_PARAMS);
  return { passwordHash, salt: resolvedSalt, key };
}

function deriveKeyForSalt(derivedKey: DerivedKey, salt: Buffer): Buffer {
  if (derivedKey.salt.equals(salt)) {
    return derivedKey.key;
  }
  return crypto.scryptSync(derivedKey.passwordHash, salt, KEY_LENGTH, SCRYPT_PARAMS);
}

export function encrypt(plaintext: Buffer, derivedKey: DerivedKey): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([derivedKey.salt, iv, authTag, ciphertext]);
}

export function decrypt(encryptedPayload: Buffer, derivedKey: DerivedKey): Buffer {
  if (encryptedPayload.length < OVERHEAD) {
    throw new Error("Data is too short to be encrypted content.");
  }

  let offset = 0;
  const salt = encryptedPayload.subarray(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;
  const iv = encryptedPayload.subarray(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;
  const authTag = encryptedPayload.subarray(offset, offset + AUTH_TAG_LENGTH);
  offset += AUTH_TAG_LENGTH;
  const ciphertext = encryptedPayload.subarray(offset);

  const key = deriveKeyForSalt(derivedKey, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Decryption failed — wrong password or corrupted data.");
  }
}
