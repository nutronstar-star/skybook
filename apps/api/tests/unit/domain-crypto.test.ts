import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  calculateRefundPercentage,
  canonicalizeJson,
  verifyTicketQrToken,
  type TicketQrPayload
} from '@skybook/shared';
import {
  blindIndexPii,
  decryptPii,
  encryptPii,
  maskEmailDomain,
  maskGovtIdLast4,
  maskPhoneLast4
} from '@skybook/database';
import { scrubPiiString, scrubPiiValue } from '../../src/shared/logger/pii-scrubber.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
} from '../../src/shared/security/jwt.js';

describe('Unit · Shared Domain Rules & Ed25519 QR Cryptography', () => {
  it('computes deterministic refund tiers by hours before departure (FR-PAX-039)', () => {
    expect(calculateRefundPercentage(96)).toBe(90);
    expect(calculateRefundPercentage(72)).toBe(90);
    expect(calculateRefundPercentage(48)).toBe(75);
    expect(calculateRefundPercentage(24)).toBe(75);
    expect(calculateRefundPercentage(10)).toBe(50);
    expect(calculateRefundPercentage(4)).toBe(50);
    expect(calculateRefundPercentage(2)).toBe(0);
  });

  it('produces identical canonical JSON regardless of object key order', () => {
    const a = { z: 1, a: { d: true, b: [3, 2, 1] } };
    const b = { a: { b: [3, 2, 1], d: true }, z: 1 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(canonicalizeJson(a)).toBe('{"a":{"b":[3,2,1],"d":true},"z":1}');
  });

  it('verifies valid Ed25519 QR tokens offline and rejects tampered payloads (FR-PAX-031)', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const spkiB64 = Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).toString('base64');

    const payload: TicketQrPayload = {
      version: 'v1',
      ticketId: '11111111-1111-4111-8111-111111111111',
      bookingId: '22222222-2222-4222-8222-222222222222',
      flightId: '33333333-3333-4333-8333-333333333333',
      seatId: '44444444-4444-4444-8444-444444444444',
      seatLabel: '12A',
      passengerName: 'Aarav Sharma',
      issuedAt: new Date().toISOString(),
      nonce: 'abcdef1234567890'
    };

    const canonical = canonicalizeJson(payload);
    const payloadB64 = Buffer.from(canonical, 'utf8').toString('base64url');
    const sigB64 = sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64url');
    const token = `v1:${payloadB64}:${sigB64}`;

    const validRes = verifyTicketQrToken(token, spkiB64);
    expect(validRes.valid).toBe(true);
    expect(validRes.payload?.seatLabel).toBe('12A');

    // Tamper passenger name
    const tamperedPayload = { ...payload, passengerName: 'Imposter Name' };
    const tamperedB64 = Buffer.from(canonicalizeJson(tamperedPayload), 'utf8').toString('base64url');
    const tamperedToken = `v1:${tamperedB64}:${sigB64}`;
    expect(verifyTicketQrToken(tamperedToken, spkiB64)).toEqual({
      valid: false,
      reason: 'INVALID_SIGNATURE'
    });

    // Malformed & unsupported versions
    expect(verifyTicketQrToken('bad-token', spkiB64).reason).toBe('MALFORMED_TOKEN');
    expect(verifyTicketQrToken('v2:abc:def', spkiB64).reason).toBe('UNSUPPORTED_VERSION');
  });
});

describe('Unit · AES-256-GCM PII Encryption, Masking & Pino Log Scrubber', () => {
  it('round-trips AES-256-GCM ciphertext with unique IVs and deterministic blind indexes', () => {
    const c1 = encryptPii('Aarav Sharma');
    const c2 = encryptPii('Aarav Sharma');
    expect(c1).not.toBe(c2);
    expect(decryptPii(c1)).toBe('Aarav Sharma');
    expect(decryptPii(c2)).toBe('Aarav Sharma');
    expect(() => decryptPii('invalid')).toThrow();

    expect(blindIndexPii('Test@Example.com ')).toBe(blindIndexPii('test@example.com'));
    expect(maskPhoneLast4('3210')).toBe('+91XXXXXX3210');
    expect(maskEmailDomain('skybook.in')).toBe('***@skybook.in');
    expect(maskEmailDomain(null)).toBeNull();
    expect(maskGovtIdLast4('9012')).toBe('XXXX-XXXX-9012');
  });

  it('scrubs all 7 PII patterns from log strings and nested objects (CON-L-03)', () => {
    const raw =
      'User +919876543210 (aarav@example.com) Aadhaar 1234 5678 9012 PAN ABCDE1234F key rzp_test_Secret123';
    const scrubbed = scrubPiiString(raw);
    expect(scrubbed).not.toContain('9876543210');
    expect(scrubbed).not.toContain('aarav@example.com');
    expect(scrubbed).not.toContain('1234 5678 9012');
    expect(scrubbed).not.toContain('ABCDE1234F');
    expect(scrubbed).not.toContain('rzp_test_Secret123');

    const obj = scrubPiiValue({
      phone: '+919876543210',
      nested: { note: 'Contact passenger at user@domain.com' }
    }) as { phone: string; nested: { note: string } };
    expect(obj.phone).toBe('[REDACTED_FIELD]');
    expect(obj.nested.note).toContain('[REDACTED_EMAIL]');
  });

  it('signs and verifies access and refresh JWTs', async () => {
    const access = await signAccessToken({
      userId: 'user-1',
      sessionId: 'sess-1',
      role: 'PASSENGER'
    });
    const claims = await verifyAccessToken(access);
    expect(claims.sub).toBe('user-1');
    expect(claims.sid).toBe('sess-1');
    expect(claims.role).toBe('PASSENGER');

    const refresh = await signRefreshToken({ userId: 'user-1', sessionId: 'sess-1' });
    const refClaims = await verifyRefreshToken(refresh);
    expect(refClaims.sub).toBe('user-1');
    await expect(verifyAccessToken('invalid.jwt.token')).rejects.toThrow();
  });
});