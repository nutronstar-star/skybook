import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function getEncryptionKey(): Buffer {
  const hex = process.env.PII_ENCRYPTION_KEY_HEX;
  if (!hex || hex.length !== 64) {
    throw new Error('PII_ENCRYPTION_KEY_HEX must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts sensitive PII fields using AES-256-GCM (NFR-S-03, NFR-D-02).
 * Output format: ivHex:authTagHex:cipherTextHex
 */
export function encryptPii(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts AES-256-GCM ciphertext produced by encryptPii().
 */
export function decryptPii(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Malformed AES-256-GCM ciphertext');
  }
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Deterministic HMAC-SHA256 blind index for querying encrypted phone/email fields.
 */
export function blindIndexPii(value: string): string {
  const key = getEncryptionKey();
  return createHmac('sha256', key).update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Role-based PII masking helpers (FR-ADM-011, NFR-S-09).
 */
export function maskPhoneLast4(last4: string): string {
  return `+91XXXXXX${last4}`;
}

export function maskEmailDomain(emailDomain: string | null): string | null {
  if (!emailDomain) return null;
  return `***@${emailDomain}`;
}

export function maskGovtIdLast4(last4: string): string {
  return `XXXX-XXXX-${last4}`;
}