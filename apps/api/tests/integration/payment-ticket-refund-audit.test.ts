import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { prisma } from '@skybook/database';
import { verifyTicketQrToken } from '@skybook/shared';
import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  cleanupBookingArtifacts,
  clearRedisTestKeys,
  loginDefaultAdmin,
  loginPassengerWithPhone
} from '../helpers/test-utils.js';

describe('Integration · E2E Booking, Idempotent Payment, Ed25519 QR, Refund, WS & Audit', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp({
      enableWebSockets: true,
      wsHandshakeTimeoutMs: 400,
      enableWorkers: true
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  beforeEach(async () => {
    await clearRedisTestKeys();
  });

  afterAll(async () => {
    await app.close();
  });

  it('completes full E2E flow: search -> lock -> book -> idempotent pay -> webhook -> Ed25519 QR -> cancel -> refund (SC-01..04)', async () => {
    const pax = await loginPassengerWithPhone(app, '+919876543210');
    const otherPax = await loginPassengerWithPhone(app, '+919844445555');

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

    // 1. Lock & Create PENDING booking
    const lockRes = await app.inject({
      method: 'POST',
      url: '/v1/seats/lock',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: { flightId: flight.id, seatIds: [seat.id] }
    });
    const { lockId } = lockRes.json<{ lockId: string }>();

    const bookRes = await app.inject({
      method: 'POST',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: {
        lockId,
        cabinClass: 'ECONOMY',
        passengers: [
          {
            seatId: seat.id,
            fullName: 'Ananya Verma',
            age: 27,
            gender: 'FEMALE',
            govtIdType: 'PAN',
            govtIdNumber: 'ABCDE1234F'
          }
        ]
      }
    });
    const booking = bookRes.json<{ id: string; pnr: string; totalAmountPaise: number }>();

    // 2. Payment Order Idempotency (FR-PAX-025..026, BR-05)
    const idemKey = `idem_${randomUUID()}`;
    const order1 = await app.inject({
      method: 'POST',
      url: '/v1/payments/orders',
      headers: {
        authorization: `Bearer ${pax.accessToken}`,
        'idempotency-key': idemKey
      },
      payload: { bookingId: booking.id }
    });
    expect(order1.statusCode).toBe(201);
    const { razorpayOrderId } = order1.json<{ razorpayOrderId: string }>();

    const orderReplay = await app.inject({
      method: 'POST',
      url: '/v1/payments/orders',
      headers: {
        authorization: `Bearer ${pax.accessToken}`,
        'idempotency-key': idemKey
      },
      payload: { bookingId: booking.id }
    });
    expect(orderReplay.statusCode).toBe(201);
    expect(orderReplay.headers['x-idempotent-replay']).toBe('true');

    const orderConflict = await app.inject({
      method: 'POST',
      url: '/v1/payments/orders',
      headers: {
        authorization: `Bearer ${pax.accessToken}`,
        'idempotency-key': idemKey
      },
      payload: { bookingId: randomUUID() }
    });
    expect(orderConflict.statusCode).toBe(409);

    // 3. HMAC-SHA256 Webhook + Duplicate Delivery Deduplication (FR-PAX-027, FR-PAX-030)
    const whBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_e2e_${randomUUID().slice(0, 12)}`,
            order_id: razorpayOrderId,
            method: 'card'
          }
        }
      }
    });
    const sig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(whBody).digest('hex');
    const eventId = `evt_${randomUUID()}`;

    const wh1 = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId
      },
      payload: whBody
    });
    expect(wh1.statusCode).toBe(200);
    expect(wh1.json<{ duplicate: boolean }>().duplicate).toBe(false);

    const wh2 = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': sig,
        'x-razorpay-event-id': eventId
      },
      payload: whBody
    });
    expect(wh2.statusCode).toBe(200);
    expect(wh2.json<{ duplicate: boolean }>().duplicate).toBe(true);

    // 4. Poll until BullMQ worker issues signed QR e-ticket
    let qrToken = '';
    for (let i = 0; i < 30; i++) {
      const tRes = await app.inject({
        method: 'GET',
        url: `/v1/tickets/${booking.id}`,
        headers: { authorization: `Bearer ${pax.accessToken}` }
      });
      if (tRes.statusCode === 200) {
        qrToken = tRes.json<{ tickets: Array<{ qrToken: string }> }>().tickets[0]!.qrToken;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(qrToken).toMatch(/^v1:/);

    // Cross-tenant ticket fetch returns 404 (FR-PAX-033)
    const crossTicket = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${booking.id}`,
      headers: { authorization: `Bearer ${otherPax.accessToken}` }
    });
    expect(crossTicket.statusCode).toBe(404);

    // Offline & Online Ed25519 verification (SC-03, P4)
    const pubKeyRes = await app.inject({ method: 'GET', url: '/v1/tickets/public-key' });
    const { publicKey } = pubKeyRes.json<{ publicKey: string }>();
    const offline = verifyTicketQrToken(qrToken, publicKey);
    expect(offline.valid).toBe(true);
    expect(offline.payload?.passengerName).toBe('Ananya Verma');

    // 5. Refund preview + Passenger cancellation + QR invalidation (FR-PAX-035..039)
    const previewRes = await app.inject({
      method: 'GET',
      url: `/v1/bookings/${booking.id}/refund-preview`,
      headers: { authorization: `Bearer ${pax.accessToken}` }
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = previewRes.json<{ refundAmountPaise: number }>();

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/bookings/${booking.id}/cancel`,
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: { reason: 'Change of travel plans' }
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelled = cancelRes.json<{
      bookingStatus: string;
      refund: { id: string; amountPaise: number; status: string };
    }>();
    expect(cancelled.bookingStatus).toBe('CANCELLED');
    expect(cancelled.refund.amountPaise).toBe(preview.refundAmountPaise);
    expect(cancelled.refund.status).toBe('COMPLETED');

    const postCancelVerify = await app.inject({
      method: 'POST',
      url: '/v1/tickets/verify',
      payload: { qrToken }
    });
    expect(postCancelVerify.json<{ valid: boolean; reason: string }>()).toMatchObject({
      valid: false,
      reason: 'TICKET_CANCELLED'
    });

    // Admin refund list & CSV audit export
    const adminToken = await loginDefaultAdmin(app);
    const refundsList = await app.inject({
      method: 'GET',
      url: `/v1/admin/refunds?bookingId=${booking.id}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(refundsList.statusCode).toBe(200);
    expect(refundsList.json<{ data: unknown[] }>().data).toHaveLength(1);

    const auditCsv = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit-logs/export.csv',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(auditCsv.statusCode).toBe(200);
    expect(auditCsv.body).toContain('BOOKING_CANCELLED_AND_REFUND_INITIATED');

    await cleanupBookingArtifacts({
      bookingId: booking.id,
      lockGroupId: lockId,
      seatIds: [seat.id],
      eventId
    });
  });

  it('enforces append-only immutability on audit_logs via PostgreSQL trigger (NFR-S-07, FR-ADM-022)', async () => {
    const logRow = await prisma.auditLog.findFirstOrThrow();
    await expect(
      prisma.auditLog.update({
        where: { id: logRow.id },
        data: { reason: 'Attempted tamper' }
      })
    ).rejects.toThrow(/append-only/);

    await expect(
      prisma.auditLog.delete({
        where: { id: logRow.id }
      })
    ).rejects.toThrow(/append-only/);
  });

  it('broadcasts real-time SEAT_LOCKED events over RFC 6455 WebSocket after JWT auth (FR-PAX-017, EI-07)', async () => {
    const pax = await loginPassengerWithPhone(app, '+919876543210');
    const flight = await prisma.flight.findFirstOrThrow({
      where: { status: 'PUBLISHED' },
      include: {
        flightSeats: {
          where: { status: 'AVAILABLE' },
          take: 1
        }
      }
    });
    const seat = flight.flightSeats[0]!;
    const wsUrl = baseUrl.replace('http://', 'ws://') + '/v1/ws/seats';

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const authPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString('utf8'))));
    });
    ws.send(JSON.stringify({ type: 'AUTH', token: pax.accessToken, flightId: flight.id }));
    const authAck = await authPromise;
    expect(authAck.type).toBe('AUTH_OK');

    const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString('utf8'))));
    });
    const lockRes = await app.inject({
      method: 'POST',
      url: '/v1/seats/lock',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: { flightId: flight.id, seatIds: [seat.id] }
    });
    expect(lockRes.statusCode).toBe(201);
    const { lockId } = lockRes.json<{ lockId: string }>();

    const wsEvent = await eventPromise;
    expect(wsEvent.type).toBe('SEAT_LOCKED');
    expect(wsEvent.seatIds).toEqual([seat.id]);

    ws.close();
    await cleanupBookingArtifacts({ lockGroupId: lockId, seatIds: [seat.id] });
  });
});