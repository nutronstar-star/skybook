import { createPublicKey, verify } from 'node:crypto';

export interface TicketQrPayload {
  version: 'v1';
  ticketId: string;
  bookingId: string;
  flightId: string;
  seatId: string;
  seatLabel: string;
  passengerName: string;
  issuedAt: string;
  nonce: string;
}

export interface QrVerificationResult {
  valid: boolean;
  payload?: TicketQrPayload;
  reason?: 'MALFORMED_TOKEN' | 'UNSUPPORTED_VERSION' | 'INVALID_BASE64' | 'INVALID_SIGNATURE';
}

export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalizeJson(item)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`);
  return `{${entries.join(',')}}`;
}

export function verifyTicketQrToken(
  token: string,
  publicKeySpkiBase64: string
): QrVerificationResult {
  const parts = token.split(':');
  if (parts.length !== 3) {
    return { valid: false, reason: 'MALFORMED_TOKEN' };
  }

  const version = parts[0];
  const payloadB64 = parts[1];
  const signatureB64 = parts[2];

  if (version !== 'v1' || !payloadB64 || !signatureB64) {
    return { valid: false, reason: 'UNSUPPORTED_VERSION' };
  }

  let parsedPayload: TicketQrPayload;
  try {
    const rawJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    parsedPayload = JSON.parse(rawJson) as TicketQrPayload;
  } catch {
    return { valid: false, reason: 'INVALID_BASE64' };
  }

  try {
    const canonical = canonicalizeJson(parsedPayload);
    const keyDer = Buffer.from(publicKeySpkiBase64, 'base64');
    const keyObj = createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
    const sigBuf = Buffer.from(signatureB64, 'base64url');

    const ok = verify(null, Buffer.from(canonical, 'utf8'), keyObj, sigBuf);
    if (!ok) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }
    return { valid: true, payload: parsedPayload };
  } catch {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }
}