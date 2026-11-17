import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@skybook/database';
import { canonicalizeJson, type TicketQrPayload } from '@skybook/shared';
import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  cleanupBookingArtifacts,
  clearRedisTestKeys,
  loginDefaultAdmin,
  loginPassengerWithPhone
} from '../helpers/test-utils.js';

describe('Integration · Residual Filter, Validation & Negative State Branches', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ enableWebSockets: false, enableWorkers: false });
  });

  beforeEach(async () => {
    await clearRedisTestKeys();
    await prisma.otpChallenge.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('exercises identity negative branches: OTP rate limit, expired OTP, short admin password & unknown reset email', async () => {
    const phone = '+919876543210';

    // 3 allowed OTP requests, 4th triggers 429
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        payload: { phone }
      });
      expect(r.statusCode).toBe(200);
    }
    const fourth = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone }
    });
    expect(fourth.statusCode).toBe(429);

    // Expire the challenge in DB and verify 400 OTP_EXPIRED
    await prisma.otpChallenge.updateMany({
      data: { expiresAt: new Date(Date.now() - 60_000) }
    });
    const expiredRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone, otp: '123456' }
    });
    expect(expiredRes.statusCode).toBe(400);
    expect(expiredRes.json<{ error: { code: string } }>().error.code).toBe('OTP_EXPIRED');

    // Refresh with invalid token -> 401
    const badRefresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: 'invalid-refresh-token-value-1234567890' }
    });
    expect(badRefresh.statusCode).toBe(401);

    // Admin password too short -> 400 PASSWORD_TOO_SHORT
    const shortAdminPw = await app.inject({
      method: 'POST',
      url: '/v1/auth/admin/login',
      payload: { email: 'admin@skybook.in', password: 'short' }
    });
    expect(shortAdminPw.statusCode).toBe(400);
    expect(shortAdminPw.json<{ error: { code: string } }>().error.code).toBe('PASSWORD_TOO_SHORT');

    // Admin password reset for non-existent email returns generic accepted=true
    const unknownReset = await app.inject({
      method: 'POST',
      url: '/v1/auth/admin/password-reset/request',
      payload: { email: 'nobody@skybook.in' }
    });
    expect(unknownReset.statusCode).toBe(200);
    expect(unknownReset.json<{ accepted: boolean }>().accepted).toBe(true);
  });

  it('exercises flight search timeOfDay filters & admin flight/city/airport error branches', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    for (const tod of ['MORNING', 'EVENING', 'NIGHT'] as const) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/flights/search?origin=DEL&destination=BOM&date=${tomorrow}&timeOfDay=${tod}&sortBy=departure&sortOrder=desc`
      });
      expect(res.statusCode).toBe(200);
    }

    const adminToken = await loginDefaultAdmin(app);
    const fakeId = randomUUID();

    // 404 branches on non-existent flight/city/airport mutations
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/admin/flights/${fakeId}`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { economyBasePaise: 500000, reason: 'Testing missing flight update' }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/flights/${fakeId}/publish`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Testing missing flight publish' }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/flights/${fakeId}/cancel`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Testing missing flight cancel' }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/admin/cities/${fakeId}`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { name: 'Ghost City', reason: 'Testing missing city update' }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/admin/airports/${fakeId}`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { name: 'Ghost Airport', reason: 'Testing missing airport update' }
        })
      ).statusCode
    ).toBe(404);

    // Publishing an already PUBLISHED flight -> 400 INVALID_TRANSITION
    const publishedFlight = await prisma.flight.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
    const rePublish = await app.inject({
      method: 'POST',
      url: `/v1/admin/flights/${publishedFlight.id}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Attempting duplicate publish' }
    });
    expect(rePublish.statusCode).toBe(400);
  });

  it('exercises booking, ticket, payment & refund negative and filter branches', async () => {
    const pax = await loginPassengerWithPhone(app, '+919876543210');
    const adminToken = await loginDefaultAdmin(app);
    const fakeId = randomUUID();

    // Non-existent flight lock, lock release, booking detail, booking patch, ticket & refund preview -> 404
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/seats/lock',
          headers: { authorization: `Bearer ${pax.accessToken}` },
          payload: { flightId: fakeId, seatIds: [randomUUID()] }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/seats/lock/${fakeId}`,
          headers: { authorization: `Bearer ${pax.accessToken}` }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/bookings/${fakeId}`,
          headers: { authorization: `Bearer ${pax.accessToken}` }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/bookings/${fakeId}`,
          headers: { authorization: `Bearer ${pax.accessToken}` },
          payload: {}
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/tickets/${fakeId}`,
          headers: { authorization: `Bearer ${pax.accessToken}` }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/bookings/${fakeId}/refund-preview`,
          headers: { authorization: `Bearer ${pax.accessToken}` }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/bookings/${fakeId}/cancel`,
          headers: { authorization: `Bearer ${pax.accessToken}` }
        })
      ).statusCode
    ).toBe(404);

    // Admin 404 branches for unmask & refund approve/reject/retry
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/bookings/${fakeId}/unmask`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Unmasking missing booking' }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/refunds/${fakeId}/approve`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Approving missing refund' }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/refunds/${fakeId}/reject`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Rejecting missing refund' }
        })
      ).statusCode
    ).toBe(404);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/admin/refunds/${fakeId}/retry`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { reason: 'Retrying missing refund' }
        })
      ).statusCode
    ).toBe(404);

    // Admin bookings & refunds filtered list queries
    const filteredBookings = await app.inject({
      method: 'GET',
      url: '/v1/admin/bookings?status=PENDING&dateFrom=2026-01-01&dateTo=2027-12-31',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(filteredBookings.statusCode).toBe(200);

    const filteredRefunds = await app.inject({
      method: 'GET',
      url: '/v1/admin/refunds?status=COMPLETED',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(filteredRefunds.statusCode).toBe(200);

    // Lock a seat, expire it, and verify LOCK_EXPIRED branch on booking creation
    const flight = await prisma.flight.findFirstOrThrow({
      where: { status: 'PUBLISHED' },
      include: {
        flightSeats: {
          where: { status: 'AVAILABLE', cabinClass: 'ECONOMY' },
          take: 1
        }
      }
    });
    const seat = flight.flightSeats[0]!;

    const lockRes = await app.inject({
      method: 'POST',
      url: '/v1/seats/lock',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: { flightId: flight.id, seatIds: [seat.id] }
    });
    const { lockId } = lockRes.json<{ lockId: string }>();

    // Wrong cabin class mismatch -> 400 VALIDATION_ERROR
    const wrongCabin = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: {
        lockId,
        cabinClass: 'BUSINESS',
        passengers: [
          {
            seatId: seat.id,
            fullName: 'Cabin Mismatch',
            age: 29,
            gender: 'MALE',
            govtIdType: 'PAN',
            govtIdNumber: 'ABCDE1234F'
          }
        ]
      }
    });
    expect(wrongCabin.statusCode).toBe(400);

    // Expire lock in DB -> 400 LOCK_EXPIRED
    await prisma.seatLock.updateMany({
      where: { lockGroupId: lockId },
      data: { expiresAt: new Date(Date.now() - 10_000) }
    });
    const expiredLockBook = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: {
        lockId,
        cabinClass: 'ECONOMY',
        passengers: [
          {
            seatId: seat.id,
            fullName: 'Expired Lock',
            age: 29,
            gender: 'MALE',
            govtIdType: 'PAN',
            govtIdNumber: 'ABCDE1234F'
          }
        ]
      }
    });
    expect(expiredLockBook.statusCode).toBe(400);
    expect(expiredLockBook.json<{ error: { code: string } }>().error.code).toBe('LOCK_EXPIRED');

    // Verify ticket signed with foreign key -> valid=false
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    void publicKey;
    const fakePayload: TicketQrPayload = {
      version: 'v1',
      ticketId: randomUUID(),
      bookingId: randomUUID(),
      flightId: flight.id,
      seatId: seat.id,
      seatLabel: seat.seatNumber,
      passengerName: 'Foreign Signer',
      issuedAt: new Date().toISOString(),
      nonce: '0011223344556677'
    };
    const canon = canonicalizeJson(fakePayload);
    const foreignToken = `v1:${Buffer.from(canon).toString('base64url')}:${sign(null, Buffer.from(canon), privateKey).toString('base64url')}`;
    const verifyForeign = await app.inject({
      method: 'POST',
      url: '/v1/tickets/verify',
      payload: { qrToken: foreignToken }
    });
    expect(verifyForeign.json<{ valid: boolean }>().valid).toBe(false);

    // refund.failed webhook branch
    const whFailBody = JSON.stringify({
      event: 'refund.failed',
      payload: { refund: { entity: { id: 'rfnd_nonexistent_123', status: 'failed' } } }
    });
    const whFailSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(whFailBody).digest('hex');
    const whFailEvt = `evt_${randomUUID()}`;
    const whFailRes = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': whFailSig,
        'x-razorpay-event-id': whFailEvt
      },
      payload: whFailBody
    });
    expect(whFailRes.statusCode).toBe(200);

    await cleanupBookingArtifacts({ lockGroupId: lockId, seatIds: [seat.id], eventId: whFailEvt });
  });
});