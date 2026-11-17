import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { prisma } from '@skybook/database';
import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  cleanupBookingArtifacts,
  clearRedisTestKeys,
  loginDefaultAdmin,
  loginPassengerWithPhone
} from '../helpers/test-utils.js';

describe('Integration · RBAC Guards, Validation Branches, Flight Cancel Cascade & WS Edge Cases', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp({
      enableWebSockets: true,
      wsHandshakeTimeoutMs: 500,
      enableWorkers: false
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  beforeEach(async () => {
    await clearRedisTestKeys();
    await prisma.otpChallenge.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
  });

  it('exercises auth/RBAC 401 & 404 guards, Zod 422 validation errors, and global error handler branches', async () => {
    // 1. Missing / malformed Bearer token -> 401 UNAUTHORIZED
    const noAuth = await app.inject({ method: 'GET', url: '/v1/users/me' });
    expect(noAuth.statusCode).toBe(401);

    const badAuth = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: 'Bearer invalid.jwt.string' }
    });
    expect(badAuth.statusCode).toBe(401);

    // 2. Role mismatch returns 404 (not 403) per FR-XC-002
    const pax = await loginPassengerWithPhone(app, '+919876543210');
    const adminToken = await loginDefaultAdmin(app);

    const paxOnAdmin = await app.inject({
      method: 'GET',
      url: '/v1/admin/bookings',
      headers: { authorization: `Bearer ${pax.accessToken}` }
    });
    expect(paxOnAdmin.statusCode).toBe(404);

    const adminOnPax = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(adminOnPax.statusCode).toBe(404);

    // 3. Zod validation error -> 422 VALIDATION_ERROR
    const badSearch = await app.inject({
      method: 'GET',
      url: '/v1/flights/search?origin=INVALID&destination=DEL&date=not-a-date'
    });
    expect(badSearch.statusCode).toBe(422);
    expect(badSearch.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');

    // Same origin & destination -> 400 VALIDATION_ERROR
    const sameRoute = await app.inject({
      method: 'GET',
      url: '/v1/flights/search?origin=DEL&destination=DEL&date=2026-12-01'
    });
    expect(sameRoute.statusCode).toBe(400);

    // Non-existent flight & seat map -> 404 NOT_FOUND
    const missingFlight = await app.inject({
      method: 'GET',
      url: `/v1/flights/${randomUUID()}`
    });
    expect(missingFlight.statusCode).toBe(404);

    const missingSeatMap = await app.inject({
      method: 'GET',
      url: `/v1/flights/${randomUUID()}/seat-map`
    });
    expect(missingSeatMap.statusCode).toBe(404);
  });

  it('exercises seat lock validation branches, booking mismatches, payment transitions & refund webhook events', async () => {
    const paxA = await loginPassengerWithPhone(app, '+919876543210');
    const paxB = await loginPassengerWithPhone(app, '+919855556666');

    const flight = await prisma.flight.findFirstOrThrow({
      where: { status: 'PUBLISHED' },
      include: {
        flightSeats: {
          where: { status: 'AVAILABLE', cabinClass: 'ECONOMY' },
          take: 2
        }
      }
    });
    const seat1 = flight.flightSeats[0]!;
    const seat2 = flight.flightSeats[1]!;

    // Duplicate seatIds in lock request -> 400
    const dupSeats = await app.inject({
      method: 'POST',
      url: '/v1/seats/lock',
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: { flightId: flight.id, seatIds: [seat1.id, seat1.id] }
    });
    expect(dupSeats.statusCode).toBe(400);

    // Non-existent seatId -> 400
    const unknownSeat = await app.inject({
      method: 'POST',
      url: '/v1/seats/lock',
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: { flightId: flight.id, seatIds: [randomUUID()] }
    });
    expect(unknownSeat.statusCode).toBe(400);

    // Valid lock by paxA
    const lockRes = await app.inject({
      method: 'POST',
      url: '/v1/seats/lock',
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: { flightId: flight.id, seatIds: [seat1.id] }
    });
    expect(lockRes.statusCode).toBe(201);
    const { lockId } = lockRes.json<{ lockId: string }>();

    // Cross-tenant lock release by paxB -> 404
    const crossRelease = await app.inject({
      method: 'DELETE',
      url: `/v1/seats/lock/${lockId}`,
      headers: { authorization: `Bearer ${paxB.accessToken}` }
    });
    expect(crossRelease.statusCode).toBe(404);

    // Cross-tenant booking attempt using paxA's lockId -> 404
    const crossBook = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${paxB.accessToken}` },
      payload: {
        lockId,
        cabinClass: 'ECONOMY',
        passengers: [
          {
            seatId: seat1.id,
            fullName: 'Intruder User',
            age: 30,
            gender: 'MALE',
            govtIdType: 'PAN',
            govtIdNumber: 'ZZZZZ9999Z'
          }
        ]
      }
    });
    expect(crossBook.statusCode).toBe(404);

    // Mismatched passenger count -> 400 MISSING_PASSENGER
    const wrongCount = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: {
        lockId,
        cabinClass: 'ECONOMY',
        passengers: [
          {
            seatId: seat1.id,
            fullName: 'Pax One',
            age: 28,
            gender: 'MALE',
            govtIdType: 'PAN',
            govtIdNumber: 'ABCDE1111F'
          },
          {
            seatId: seat2.id,
            fullName: 'Pax Two',
            age: 26,
            gender: 'FEMALE',
            govtIdType: 'PAN',
            govtIdNumber: 'ABCDE2222F'
          }
        ]
      }
    });
    expect(wrongCount.statusCode).toBe(400);

    // Valid booking creation -> PENDING
    const validBook = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${paxA.accessToken}` },
      payload: {
        lockId,
        cabinClass: 'ECONOMY',
        passengers: [
          {
            seatId: seat1.id,
            fullName: 'Kavya Nair',
            age: 32,
            gender: 'FEMALE',
            govtIdType: 'AADHAAR',
            govtIdNumber: '445566778899'
          }
        ]
      }
    });
    expect(validBook.statusCode).toBe(201);
    const bookingId = validBook.json<{ id: string }>().id;

    // Cancelling a PENDING booking -> 400 INVALID_TRANSITION
    const cancelPending = await app.inject({
      method: 'POST',
      url: `/v1/bookings/${bookingId}/cancel`,
      headers: { authorization: `Bearer ${paxA.accessToken}` }
    });
    expect(cancelPending.statusCode).toBe(400);

    // Cross-tenant payment order & status -> 404
    const crossOrder = await app.inject({
      method: 'POST',
      url: '/v1/payments/orders',
      headers: {
        authorization: `Bearer ${paxB.accessToken}`,
        'idempotency-key': `idem_${randomUUID()}`
      },
      payload: { bookingId }
    });
    expect(crossOrder.statusCode).toBe(404);

    const crossPayStatus = await app.inject({
      method: 'GET',
      url: `/v1/payments/${bookingId}/status`,
      headers: { authorization: `Bearer ${paxB.accessToken}` }
    });
    expect(crossPayStatus.statusCode).toBe(404);

    // Create valid order & settle via webhook
    const order = (
      await app.inject({
        method: 'POST',
        url: '/v1/payments/orders',
        headers: {
          authorization: `Bearer ${paxA.accessToken}`,
          'idempotency-key': `idem_${randomUUID()}`
        },
        payload: { bookingId }
      })
    ).json<{ paymentIntentId: string; razorpayOrderId: string }>();

    const capBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_br_${randomUUID().slice(0, 10)}`,
            order_id: order.razorpayOrderId,
            method: 'upi'
          }
        }
      }
    });
    const capSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(capBody).digest('hex');
    const capEvtId = `evt_${randomUUID()}`;
    await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': capSig,
        'x-razorpay-event-id': capEvtId
      },
      payload: capBody
    });

    // Initiating payment on already-CONFIRMED booking -> 400 INVALID_TRANSITION
    const payConfirmed = await app.inject({
      method: 'POST',
      url: '/v1/payments/orders',
      headers: {
        authorization: `Bearer ${paxA.accessToken}`,
        'idempotency-key': `idem_${randomUUID()}`
      },
      payload: { bookingId }
    });
    expect(payConfirmed.statusCode).toBe(400);

    // Exercise refund.processed webhook event & unhandled webhook event
    const rzRefundId = `rfnd_wh_${randomUUID().slice(0, 10)}`;
    await prisma.refund.create({
      data: {
        bookingId,
        paymentIntentId: order.paymentIntentId,
        initiatedByUserId: paxA.userId,
        amountPaise: 120000,
        refundPercentage: 50,
        status: 'PROCESSING',
        reason: 'Webhook settlement coverage test',
        razorpayRefundId: rzRefundId
      }
    });

    const refWhBody = JSON.stringify({
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: rzRefundId,
            status: 'processed'
          }
        }
      }
    });
    const refWhSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(refWhBody).digest('hex');
    const refEvtId = `evt_${randomUUID()}`;
    const refWhRes = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': refWhSig,
        'x-razorpay-event-id': refEvtId
      },
      payload: refWhBody
    });
    expect(refWhRes.statusCode).toBe(200);

    // Unhandled Razorpay event type -> acknowledged cleanly
    const otherWhBody = JSON.stringify({ event: 'order.paid', payload: {} });
    const otherSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(otherWhBody).digest('hex');
    const otherEvtId = `evt_${randomUUID()}`;
    const otherRes = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': otherSig,
        'x-razorpay-event-id': otherEvtId
      },
      payload: otherWhBody
    });
    expect(otherRes.statusCode).toBe(200);

    await cleanupBookingArtifacts({
      bookingId,
      lockGroupId: lockId,
      seatIds: [seat1.id],
      eventId: capEvtId
    });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { in: [refEvtId, otherEvtId] } } });
  });

  it('triggers automatic 100% refunds when Admin cancels a flight with CONFIRMED bookings (FR-ADM-007)', async () => {
    const adminToken = await loginDefaultAdmin(app);
    const pax = await loginPassengerWithPhone(app, '+919876543210');

    const [del, bom, a320] = await Promise.all([
      prisma.airport.findUniqueOrThrow({ where: { iataCode: 'DEL' } }),
      prisma.airport.findUniqueOrThrow({ where: { iataCode: 'BOM' } }),
      prisma.aircraftType.findUniqueOrThrow({ where: { code: 'A320NEO' } })
    ]);

    // Create & publish dedicated flight for cancellation cascade test
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/admin/flights',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        flightNumber: 'SB-888',
        originAirportId: del.id,
        destinationAirportId: bom.id,
        aircraftTypeId: a320.id,
        departureTime: '2026-12-20T09:00:00.000Z',
        arrivalTime: '2026-12-20T11:15:00.000Z',
        economyBasePaise: 500000,
        businessBasePaise: 1500000,
        reason: 'Creating flight for cancellation refund cascade test'
      }
    });
    const flightId = createRes.json<{ id: string }>().id;

    await app.inject({
      method: 'POST',
      url: `/v1/admin/flights/${flightId}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Publishing flight for cascade test' }
    });

    const seat = await prisma.flightSeat.findFirstOrThrow({
      where: { flightId, cabinClass: 'ECONOMY' }
    });

    const lock = (
      await app.inject({
        method: 'POST',
        url: '/v1/seats/lock',
        headers: { authorization: `Bearer ${pax.accessToken}` },
        payload: { flightId, seatIds: [seat.id] }
      })
    ).json<{ lockId: string }>();

    const booking = (
      await app.inject({
        method: 'POST',
        url: '/v1/bookings',
        headers: { authorization: `Bearer ${pax.accessToken}` },
        payload: {
          lockId: lock.lockId,
          cabinClass: 'ECONOMY',
          passengers: [
            {
              seatId: seat.id,
              fullName: 'Siddharth Menon',
              age: 35,
              gender: 'MALE',
              govtIdType: 'PASSPORT',
              govtIdNumber: 'P1122334'
            }
          ]
        }
      })
    ).json<{ id: string }>();

    const order = (
      await app.inject({
        method: 'POST',
        url: '/v1/payments/orders',
        headers: {
          authorization: `Bearer ${pax.accessToken}`,
          'idempotency-key': `idem_${randomUUID()}`
        },
        payload: { bookingId: booking.id }
      })
    ).json<{ razorpayOrderId: string }>();

    const capBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_casc_${randomUUID().slice(0, 10)}`,
            order_id: order.razorpayOrderId,
            method: 'card'
          }
        }
      }
    });
    const capSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(capBody).digest('hex');
    const capEvtId = `evt_${randomUUID()}`;
    await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': capSig,
        'x-razorpay-event-id': capEvtId
      },
      payload: capBody
    });

    // Admin cancels the flight -> triggers 100% refund & invalidates ticket
    const cancelFlightRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/flights/${flightId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Severe weather disruption on DEL-BOM sector' }
    });
    expect(cancelFlightRes.statusCode).toBe(200);

    const updatedBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { refunds: true, tickets: true }
    });
    expect(updatedBooking.status).toBe('CANCELLED');
    expect(updatedBooking.refunds[0]?.refundPercentage).toBe(100);
    expect(updatedBooking.refunds[0]?.status).toBe('COMPLETED');
    expect(updatedBooking.tickets[0]?.status).toBe('CANCELLED');

    await cleanupBookingArtifacts({
      bookingId: booking.id,
      lockGroupId: lock.lockId,
      eventId: capEvtId
    });
    await prisma.flight.delete({ where: { id: flightId } });
  });

  it('enforces WebSocket non-AUTH rejection (4003), invalid JWT (4003), and 60 msg/min rate limit (4008)', async () => {
    const wsUrl = baseUrl.replace('http://', 'ws://') + '/v1/ws/seats';

    // 1. Sending PING before AUTH -> 4003 UNAUTHORIZED
    const unauthPingWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => unauthPingWs.once('open', () => resolve()));
    unauthPingWs.send(JSON.stringify({ type: 'PING' }));
    const code1 = await new Promise<number>((resolve) => {
      unauthPingWs.once('close', (c) => resolve(c));
    });
    expect(code1).toBe(4003);

    // 2. Sending invalid JWT in AUTH -> 4003 INVALID_TOKEN
    const badTokenWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => badTokenWs.once('open', () => resolve()));
    badTokenWs.send(JSON.stringify({ type: 'AUTH', token: 'invalid.jwt.token.value' }));
    const code2 = await new Promise<number>((resolve) => {
      badTokenWs.once('close', (c) => resolve(c));
    });
    expect(code2).toBe(4003);

    // 3. Exceeding 60 WebSocket messages/min -> 4008 RATE_LIMIT_EXCEEDED
    const pax = await loginPassengerWithPhone(app, '+919876543210');
    const floodWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => floodWs.once('open', () => resolve()));

    const authAck = new Promise<void>((resolve) => {
      floodWs.once('message', () => resolve());
    });
    floodWs.send(JSON.stringify({ type: 'AUTH', token: pax.accessToken }));
    await authAck;

    const rateLimitClose = new Promise<number>((resolve) => {
      floodWs.once('close', (c) => resolve(c));
    });
    for (let i = 0; i < 65; i++) {
      if (floodWs.readyState === WebSocket.OPEN) {
        floodWs.send(JSON.stringify({ type: 'PING' }));
      }
    }
    const code3 = await rateLimitClose;
    expect(code3).toBe(4008);
  });
});