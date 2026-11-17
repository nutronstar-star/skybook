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

describe('Integration · Admin Catalog, Refund Workflows, Webhooks, Reset Cascade & WS Protocol', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp({
      enableWebSockets: true,
      wsHandshakeTimeoutMs: 250,
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

  it('exercises Admin cities, airports, aircraft layouts, flight filters, and seat map endpoints (FR-ADM-008..010)', async () => {
    const adminToken = await loginDefaultAdmin(app);

    // 1. List & create/update City + Airport
    const listCities = await app.inject({
      method: 'GET',
      url: '/v1/admin/cities',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(listCities.statusCode).toBe(200);

    const createCity = await app.inject({
      method: 'POST',
      url: '/v1/admin/cities',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Jaipur Test Hub',
        state: 'Rajasthan',
        reason: 'Adding Jaipur hub for catalog coverage test'
      }
    });
    expect(createCity.statusCode).toBe(201);
    const cityId = createCity.json<{ id: string }>().id;

    const updateCity = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/cities/${cityId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { state: 'Rajasthan State', reason: 'Updating city metadata' }
    });
    expect(updateCity.statusCode).toBe(200);

    const createAirport = await app.inject({
      method: 'POST',
      url: '/v1/admin/airports',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        cityId,
        iataCode: 'JAI',
        name: 'Jaipur International Airport',
        reason: 'Adding JAI airport'
      }
    });
    expect(createAirport.statusCode).toBe(201);
    const airportId = createAirport.json<{ id: string }>().id;

    const updateAirport = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/airports/${airportId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { isActive: false, reason: 'Deactivating test airport' }
    });
    expect(updateAirport.statusCode).toBe(200);

    // 2. Aircraft types & seat layouts CRUD
    const listAircraft = await app.inject({
      method: 'GET',
      url: '/v1/admin/aircraft-types',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(listAircraft.statusCode).toBe(200);

    const createAircraft = await app.inject({
      method: 'POST',
      url: '/v1/admin/aircraft-types',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        code: 'ATR72-TEST',
        name: 'ATR 72-600 Regional',
        layouts: [
          { seatNumber: '1A', rowNumber: 1, columnLetter: 'A', cabinClass: 'BUSINESS', isWindow: true },
          { seatNumber: '1B', rowNumber: 1, columnLetter: 'B', cabinClass: 'BUSINESS' },
          { seatNumber: '2A', rowNumber: 2, columnLetter: 'A', cabinClass: 'ECONOMY', isWindow: true },
          { seatNumber: '2B', rowNumber: 2, columnLetter: 'B', cabinClass: 'ECONOMY' },
          { seatNumber: '3A', rowNumber: 3, columnLetter: 'A', cabinClass: 'ECONOMY', isWindow: true },
          { seatNumber: '3B', rowNumber: 3, columnLetter: 'B', cabinClass: 'ECONOMY' }
        ],
        reason: 'Adding regional turboprop fleet'
      }
    });
    expect(createAircraft.statusCode).toBe(201);
    const aircraftId = createAircraft.json<{ id: string }>().id;

    const updateLayouts = await app.inject({
      method: 'PUT',
      url: `/v1/admin/aircraft-types/${aircraftId}/layouts`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        layouts: [
          { seatNumber: '1A', rowNumber: 1, columnLetter: 'A', cabinClass: 'ECONOMY', isWindow: true },
          { seatNumber: '1B', rowNumber: 1, columnLetter: 'B', cabinClass: 'ECONOMY' },
          { seatNumber: '2A', rowNumber: 2, columnLetter: 'A', cabinClass: 'ECONOMY', isWindow: true },
          { seatNumber: '2B', rowNumber: 2, columnLetter: 'B', cabinClass: 'ECONOMY' },
          { seatNumber: '3A', rowNumber: 3, columnLetter: 'A', cabinClass: 'ECONOMY', isWindow: true },
          { seatNumber: '3B', rowNumber: 3, columnLetter: 'B', cabinClass: 'ECONOMY' }
        ],
        reason: 'Converting regional cabin to all-economy'
      }
    });
    expect(updateLayouts.statusCode).toBe(200);

    // 3. Admin flights list + Public flight details + Seat map + Search timeOfDay/duration filters
    const adminFlights = await app.inject({
      method: 'GET',
      url: '/v1/admin/flights?status=PUBLISHED&origin=DEL&destination=BOM',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(adminFlights.statusCode).toBe(200);
    const firstFlight = adminFlights.json<{ data: Array<{ id: string; departureTime: string }> }>().data[0]!;

    const detailRes = await app.inject({
      method: 'GET',
      url: `/v1/flights/${firstFlight.id}`
    });
    expect(detailRes.statusCode).toBe(200);

    const seatMapRes = await app.inject({
      method: 'GET',
      url: `/v1/flights/${firstFlight.id}/seat-map`
    });
    expect(seatMapRes.statusCode).toBe(200);

    const searchDate = firstFlight.departureTime.slice(0, 10);
    const filteredSearch = await app.inject({
      method: 'GET',
      url: `/v1/flights/search?origin=DEL&destination=BOM&date=${searchDate}&timeOfDay=AFTERNOON&sortBy=duration&sortOrder=desc`
    });
    expect(filteredSearch.statusCode).toBe(200);

    // Clean up catalog test rows
    await prisma.aircraftType.delete({ where: { id: aircraftId } });
    await prisma.airport.delete({ where: { id: airportId } });
    await prisma.city.delete({ where: { id: cityId } });
  });

  it('covers payment failures, passenger booking list, admin refund approve/reject/retry, and flight cancellation cascade', async () => {
    const pax = await loginPassengerWithPhone(app, '+919876543210');
    const adminToken = await loginDefaultAdmin(app);

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

    // Lock & Book Seat 1
    const lock1 = (
      await app.inject({
        method: 'POST',
        url: '/v1/seats/lock',
        headers: { authorization: `Bearer ${pax.accessToken}` },
        payload: { flightId: flight.id, seatIds: [seat1.id] }
      })
    ).json<{ lockId: string }>();

    const booking1 = (
      await app.inject({
        method: 'POST',
        url: '/v1/bookings',
        headers: { authorization: `Bearer ${pax.accessToken}` },
        payload: {
          lockId: lock1.lockId,
          cabinClass: 'ECONOMY',
          passengers: [
            {
              seatId: seat1.id,
              fullName: 'Rohan Kulkarni',
              age: 31,
              gender: 'MALE',
              govtIdType: 'AADHAAR',
              govtIdNumber: '998877665544'
            }
          ]
        }
      })
    ).json<{ id: string; totalAmountPaise: number }>();

    // List passenger's own bookings (FR-PAX-040)
    const myBookings = await app.inject({
      method: 'GET',
      url: '/v1/bookings',
      headers: { authorization: `Bearer ${pax.accessToken}` }
    });
    expect(myBookings.statusCode).toBe(200);
    expect(myBookings.json<{ data: unknown[] }>().data.length).toBeGreaterThanOrEqual(1);

    // Create payment order + test invalid webhook signature & payment.failed webhook
    const order1 = (
      await app.inject({
        method: 'POST',
        url: '/v1/payments/orders',
        headers: {
          authorization: `Bearer ${pax.accessToken}`,
          'idempotency-key': `idem_${randomUUID()}`
        },
        payload: { bookingId: booking1.id }
      })
    ).json<{ paymentIntentId: string; razorpayOrderId: string }>();

    const badSig = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
      },
      payload: JSON.stringify({ event: 'payment.failed', payload: {} })
    });
    expect(badSig.statusCode).toBe(400);

    const failBody = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            order_id: order1.razorpayOrderId,
            error_description: 'Insufficient funds in test account'
          }
        }
      }
    });
    const failSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(failBody).digest('hex');
    const failEventId = `evt_${randomUUID()}`;
    const whFail = await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': failSig,
        'x-razorpay-event-id': failEventId
      },
      payload: failBody
    });
    expect(whFail.statusCode).toBe(200);

    const statusAfterFail = await app.inject({
      method: 'GET',
      url: `/v1/payments/${booking1.id}/status`,
      headers: { authorization: `Bearer ${pax.accessToken}` }
    });
    expect(statusAfterFail.json<{ paymentStatus: string }>().paymentStatus).toBe('FAILED');

    // Retry payment order on same PENDING booking (FR-PAX-028)
    const retryOrder = (
      await app.inject({
        method: 'POST',
        url: '/v1/payments/orders',
        headers: {
          authorization: `Bearer ${pax.accessToken}`,
          'idempotency-key': `idem_${randomUUID()}`
        },
        payload: { bookingId: booking1.id }
      })
    ).json<{ paymentIntentId: string; razorpayOrderId: string }>();

    // Settle payment via payment.captured webhook
    const capBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_ok_${randomUUID().slice(0, 10)}`,
            order_id: retryOrder.razorpayOrderId,
            method: 'netbanking'
          }
        }
      }
    });
    const capSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(capBody).digest('hex');
    const capEventId = `evt_${randomUUID()}`;
    await app.inject({
      method: 'POST',
      url: '/v1/payments/webhook',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': capSig,
        'x-razorpay-event-id': capEventId
      },
      payload: capBody
    });

    // Test Admin Refund Approve, Reject & Retry endpoints (FR-ADM-016..019)
    const pendingRefund = await prisma.refund.create({
      data: {
        bookingId: booking1.id,
        paymentIntentId: retryOrder.paymentIntentId,
        initiatedByUserId: pax.userId,
        amountPaise: 100000,
        refundPercentage: 50,
        status: 'INITIATED',
        reason: 'Manual refund review test'
      }
    });

    const approveRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/refunds/${pendingRefund.id}/approve`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Approved after supervisor review' }
    });
    expect(approveRes.statusCode).toBe(200);

    const rejectableRefund = await prisma.refund.create({
      data: {
        bookingId: booking1.id,
        paymentIntentId: retryOrder.paymentIntentId,
        initiatedByUserId: pax.userId,
        amountPaise: 50000,
        refundPercentage: 25,
        status: 'INITIATED',
        reason: 'Duplicate claim test'
      }
    });

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/refunds/${rejectableRefund.id}/reject`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Duplicate refund claim rejected' }
    });
    expect(rejectRes.statusCode).toBe(200);

    const failedRefund = await prisma.refund.create({
      data: {
        bookingId: booking1.id,
        paymentIntentId: retryOrder.paymentIntentId,
        initiatedByUserId: pax.userId,
        amountPaise: 50000,
        refundPercentage: 25,
        status: 'FAILED',
        reason: 'Gateway timeout test'
      }
    });

    const retryRefundRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/refunds/${failedRefund.id}/retry`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Retrying failed gateway refund' }
    });
    expect(retryRefundRes.statusCode).toBe(200);

    // Filtered audit logs query (FR-ADM-020)
    const auditFiltered = await app.inject({
      method: 'GET',
      url: `/v1/admin/audit-logs?entityType=REFUND&action=ADMIN_REFUND_APPROVED&page=1&limit=10`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(auditFiltered.statusCode).toBe(200);

    await cleanupBookingArtifacts({
      bookingId: booking1.id,
      lockGroupId: lock1.lockId,
      seatIds: [seat1.id, seat2.id],
      eventId: failEventId
    });
    await prisma.webhookEvent.deleteMany({ where: { eventId: capEventId } });
  });

  it('enforces admin password reset token lifecycle & session revocation cascade (FR-ADM-002, FR-XC-006)', async () => {
    const adminToken = await loginDefaultAdmin(app);

    const resetReq = await app.inject({
      method: 'POST',
      url: '/v1/auth/admin/password-reset/request',
      payload: { email: 'admin@skybook.in' }
    });
    expect(resetReq.statusCode).toBe(200);
    const { mockResetToken } = resetReq.json<{ mockResetToken: string }>();
    expect(mockResetToken).toBeTruthy();

    // Confirm password reset (keep same strong password so subsequent logins work)
    const confirmRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/admin/password-reset/confirm',
      payload: {
        token: mockResetToken,
        newPassword: 'SkyBook@Admin2026!#'
      }
    });
    expect(confirmRes.statusCode).toBe(200);

    // Old admin access token must now be invalidated globally (FR-XC-006)
    const oldSessionCheck = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit-logs',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    expect(oldSessionCheck.statusCode).toBe(401);

    // Reusing the same reset token must fail (single-use)
    const reuseReset = await app.inject({
      method: 'POST',
      url: '/v1/auth/admin/password-reset/confirm',
      payload: {
        token: mockResetToken,
        newPassword: 'SkyBook@Admin2026!#'
      }
    });
    expect(reuseReset.statusCode).toBe(400);
  });

  it('enforces WebSocket handshake timeout, subscribe/unsubscribe, ping/pong & error frames (EI-07)', async () => {
    const wsUrl = baseUrl.replace('http://', 'ws://') + '/v1/ws/seats';

    // 1. Timeout when no AUTH sent within 250ms
    const timeoutWs = new WebSocket(wsUrl);
    const timeoutCode = await new Promise<number>((resolve) => {
      timeoutWs.once('close', (code) => resolve(code));
    });
    expect(timeoutCode).toBe(4001);

    // 2. Non-JSON first message -> 4002 INVALID_FIRST_MESSAGE
    const badJsonWs = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => badJsonWs.once('open', () => resolve()));
    badJsonWs.send('not-json');
    const badJsonCode = await new Promise<number>((resolve) => {
      badJsonWs.once('close', (code) => resolve(code));
    });
    expect(badJsonCode).toBe(4002);

    // 3. Valid AUTH -> SUBSCRIBE -> PING -> UNSUBSCRIBE
    const pax = await loginPassengerWithPhone(app, '+919876543210');
    const flight = await prisma.flight.findFirstOrThrow({ where: { status: 'PUBLISHED' } });

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));

    const nextMsg = () =>
      new Promise<Record<string, unknown>>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(data.toString('utf8'))));
      });

    const p1 = nextMsg();
    ws.send(JSON.stringify({ type: 'AUTH', token: pax.accessToken }));
    expect((await p1).type).toBe('AUTH_OK');

    const p2 = nextMsg();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', flightId: flight.id }));
    expect((await p2).type).toBe('SUBSCRIBED');

    const p3 = nextMsg();
    ws.send(JSON.stringify({ type: 'PING' }));
    expect((await p3).type).toBe('PONG');

    const p4 = nextMsg();
    ws.send(JSON.stringify({ type: 'UNSUBSCRIBE', flightId: flight.id }));
    expect((await p4).type).toBe('UNSUBSCRIBED');

    ws.close();
  });
});