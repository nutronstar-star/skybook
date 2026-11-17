import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@skybook/database';
import { buildApp } from '../../src/app.js';
import {
  cleanupBookingArtifacts,
  clearRedisTestKeys,
  loginDefaultAdmin,
  loginPassengerWithPhone
} from '../helpers/test-utils.js';

describe('Integration · Concurrency Locks, Atomic Booking & Admin PII Oversight', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ enableWebSockets: false, enableWorkers: false });
  });

  beforeEach(async () => {
    await clearRedisTestKeys();
  });

  afterAll(async () => {
    await app.close();
  });

  it('guarantees strictly 1 x 201 and 9 x 409 SEAT_LOCKED under 10 concurrent requests (SC-06, P2)', async () => {
    const pax = await loginPassengerWithPhone(app, '+919876543210');
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

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/v1/seats/lock',
          headers: { authorization: `Bearer ${pax.accessToken}` },
          payload: { flightId: flight.id, seatIds: [seat.id] }
        })
      )
    );

    const successes = results.filter((r) => r.statusCode === 201);
    const conflicts = results.filter((r) => r.statusCode === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
    for (const c of conflicts) {
      expect(c.json<{ error: { code: string } }>().error.code).toBe('SEAT_LOCKED');
    }

    const winningLockId = successes[0]!.json<{ lockId: string }>().lockId;

    // Active lock resume (FR-PAX-018)
    const activeRes = await app.inject({
      method: 'GET',
      url: '/v1/seats/lock/active',
      headers: { authorization: `Bearer ${pax.accessToken}` }
    });
    expect(activeRes.statusCode).toBe(200);
    expect(
      activeRes.json<{ data: Array<{ lockId: string }> }>().data.some((l) => l.lockId === winningLockId)
    ).toBe(true);

    // Manual release (FR-PAX-015)
    const relRes = await app.inject({
      method: 'DELETE',
      url: `/v1/seats/lock/${winningLockId}`,
      headers: { authorization: `Bearer ${pax.accessToken}` }
    });
    expect(relRes.statusCode).toBe(200);

    await cleanupBookingArtifacts({ lockGroupId: winningLockId, seatIds: [seat.id] });
  });

  it('enforces atomic booking, 404 cross-tenant isolation, immutability, and admin PII masking/unmasking', async () => {
    const paxA = await loginPassengerWithPhone(app, '+919876543210');
    const paxB = await loginPassengerWithPhone(app, '+919822223333');

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
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: { flightId: flight.id, seatIds: [seat.id] }
    });
    expect(lockRes.statusCode).toBe(201);
    const { lockId } = lockRes.json<{ lockId: string }>();

    const bookingRes = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: {
        lockId,
        cabinClass: 'ECONOMY',
        passengers: [
          {
            seatId: seat.id,
            fullName: 'Vikramaditya Rao',
            age: 34,
            gender: 'MALE',
            govtIdType: 'PASSPORT',
            govtIdNumber: 'Z9876543'
          }
        ]
      }
    });
    expect(bookingRes.statusCode).toBe(201);
    const booking = bookingRes.json<{ id: string; pnr: string; status: string }>();
    expect(booking.status).toBe('PENDING');

    // Cross-tenant 404 isolation (FR-XC-002, BR-09)
    const crossGet = await app.inject({
      method: 'GET',
      url: `/v1/bookings/${booking.id}`,
      headers: { authorization: `Bearer ${paxB.accessToken}` }
    });
    expect(crossGet.statusCode).toBe(404);

    // Owner detail succeeds with decrypted PII
    const ownerGet = await app.inject({
      method: 'GET',
      url: `/v1/bookings/${booking.id}`,
      headers: { authorization: `Bearer ${paxA.accessToken}` }
    });
    expect(ownerGet.statusCode).toBe(200);
    expect(
      ownerGet.json<{ passengers: Array<{ govtIdNumber: string }> }>().passengers[0]?.govtIdNumber
    ).toBe('Z9876543');

    // Immutability check (FR-PAX-024, BR-10)
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/bookings/${booking.id}`,
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: { cabinClass: 'BUSINESS' }
    });
    expect(patchRes.statusCode).toBe(400);
    expect(patchRes.json<{ error: { code: string } }>().error.code).toBe('BOOKING_IMMUTABLE');

    // Admin masked list, CSV export, audited unmask & revenue dashboard (FR-ADM-011..015)
    const adminToken = await loginDefaultAdmin(app);
    const maskedList = await app.inject({
      method: 'GET',
      url: `/v1/admin/bookings?pnr=${booking.pnr}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(maskedList.statusCode).toBe(200);
    const row = maskedList.json<{ data: Array<{ passengers: Array<{ fullNameMasked: string }> }> }>()
      .data[0]!;
    expect(row.passengers[0]!.fullNameMasked).not.toContain('Vikramaditya');

    const csvRes = await app.inject({
      method: 'GET',
      url: '/v1/admin/bookings/export.csv',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.body).toContain(booking.pnr);

    const unmaskRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/bookings/${booking.id}/unmask`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Customer support verification request' }
    });
    expect(unmaskRes.statusCode).toBe(200);
    expect(
      unmaskRes.json<{ passengers: Array<{ fullName: string; govtIdNumber: string }> }>()
        .passengers[0]
    ).toMatchObject({
      fullName: 'Vikramaditya Rao',
      govtIdNumber: 'Z9876543'
    });

    const dashRes = await app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard/revenue',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(dashRes.statusCode).toBe(200);

    await cleanupBookingArtifacts({
      bookingId: booking.id,
      lockGroupId: lockId,
      seatIds: [seat.id]
    });
  });
});