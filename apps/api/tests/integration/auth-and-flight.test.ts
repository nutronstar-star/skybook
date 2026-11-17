import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@skybook/database';
import { buildApp } from '../../src/app.js';
import { redis } from '../../src/shared/redis/client.js';
import {
  clearRedisTestKeys,
  loginDefaultAdmin,
  loginPassengerWithPhone
} from '../helpers/test-utils.js';

describe('Integration · Health, Identity, Rate Limiting & Flight Catalog', () => {
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

  it('returns 200 OK on /v1/health with Postgres and Redis up (FR-XC-008)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; services: { postgres: string; redis: string } }>();
    expect(body.status).toBe('ok');
    expect(body.services.postgres).toBe('up');
    expect(body.services.redis).toBe('up');
  });

  it('locks OTP challenge after 5 failed attempts and supports Email OTP login (FR-PAX-001, FR-PAX-002)', async () => {
    const phone = '+919876543210';
    const reqRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone }
    });
    expect(reqRes.statusCode).toBe(200);

    for (let i = 1; i <= 4; i++) {
      const bad = await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        payload: { phone, otp: '000000' }
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json<{ error: { code: string } }>().error.code).toBe('INVALID_OTP');
    }

    const fifth = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone, otp: '000000' }
    });
    expect(fifth.statusCode).toBe(400);
    expect(fifth.json<{ error: { code: string } }>().error.code).toBe('OTP_LOCKED');

    // Email OTP flow
    const email = 'vitest.pax@skybook.in';
    const emailReq = await app.inject({
      method: 'POST',
      url: '/v1/auth/email-otp/request',
      payload: { email }
    });
    expect(emailReq.statusCode).toBe(200);
    const { mockOtp } = emailReq.json<{ mockOtp: string }>();

    const emailVer = await app.inject({
      method: 'POST',
      url: '/v1/auth/email-otp/verify',
      payload: { email, otp: mockOtp, fullName: 'Email Test Passenger' }
    });
    expect(emailVer.statusCode).toBe(200);
    expect(emailVer.json<{ accessToken: string }>().accessToken).toBeTruthy();
  });

  it('enforces phone immutability, profile updates, token rotation & logout (FR-PAX-003..005, 041)', async () => {
    const pax = await loginPassengerWithPhone(app, '+919876543210');

    const updateOk = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: { fullName: 'Aarav Updated' }
    });
    expect(updateOk.statusCode).toBe(200);
    expect(updateOk.json<{ fullName: string }>().fullName).toBe('Aarav Updated');

    const updatePhone = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${pax.accessToken}` },
      payload: { phone: '+919999888877' }
    });
    expect(updatePhone.statusCode).toBe(400);
    expect(updatePhone.json<{ error: { code: string } }>().error.code).toBe('PHONE_IMMUTABLE');

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: pax.refreshToken }
    });
    expect(refreshRes.statusCode).toBe(200);
    const rotated = refreshRes.json<{ accessToken: string }>();

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${rotated.accessToken}` }
    });
    expect(logoutRes.statusCode).toBe(200);

    const revokedCheck = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${rotated.accessToken}` }
    });
    expect(revokedCheck.statusCode).toBe(401);
  });

  it('enforces auth rate limit (10/min -> 429 RATE_LIMIT_EXCEEDED) (FR-XC-003)', async () => {
    let hit429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/admin/login',
        payload: { email: 'nonexistent@skybook.in', password: 'WrongPassword123456!' }
      });
      if (res.statusCode === 429) {
        hit429 = true;
        expect(res.headers['retry-after']).toBeDefined();
        break;
      }
    }
    expect(hit429).toBe(true);
  });

  it('supports anonymous autocomplete, round-trip search, sorting & admin flight lifecycle (FR-PAX-006..011, FR-ADM-003..008)', async () => {
    const auto = await app.inject({ method: 'GET', url: '/v1/cities/autocomplete?q=mum' });
    expect(auto.statusCode).toBe(200);
    expect(auto.json<{ data: Array<{ iataCode: string }> }>().data[0]?.iataCode).toBe('BOM');

    const day1 = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const day2 = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const rt = await app.inject({
      method: 'GET',
      url: `/v1/flights/search?origin=DEL&destination=BOM&date=${day1}&returnDate=${day2}&cabinClass=ECONOMY&sortBy=price`
    });
    expect(rt.statusCode).toBe(200);
    const rtBody = rt.json<{ tripType: string; outbound: unknown[]; inbound: unknown[] }>();
    expect(rtBody.tripType).toBe('ROUND_TRIP');
    expect(rtBody.outbound.length).toBeGreaterThanOrEqual(1);
    expect(rtBody.inbound.length).toBeGreaterThanOrEqual(1);

    // Admin missing reason -> 400 REASON_REQUIRED (FR-ADM-003)
    const adminToken = await loginDefaultAdmin(app);
    const [del, bom, a320] = await Promise.all([
      prisma.airport.findUniqueOrThrow({ where: { iataCode: 'DEL' } }),
      prisma.airport.findUniqueOrThrow({ where: { iataCode: 'BOM' } }),
      prisma.aircraftType.findUniqueOrThrow({ where: { code: 'A320NEO' } })
    ]);

    const missingReason = await app.inject({
      method: 'POST',
      url: '/v1/admin/flights',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        flightNumber: 'SB-777',
        originAirportId: del.id,
        destinationAirportId: bom.id,
        aircraftTypeId: a320.id,
        departureTime: '2026-12-15T06:00:00.000Z',
        arrivalTime: '2026-12-15T08:15:00.000Z',
        economyBasePaise: 420000,
        businessBasePaise: 1260000
      }
    });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.json<{ error: { code: string } }>().error.code).toBe('REASON_REQUIRED');

    // Create -> Update -> Publish -> Cancel flight
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/flights',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        flightNumber: 'SB-777',
        originAirportId: del.id,
        destinationAirportId: bom.id,
        aircraftTypeId: a320.id,
        departureTime: '2026-12-15T06:00:00.000Z',
        arrivalTime: '2026-12-15T08:15:00.000Z',
        economyBasePaise: 420000,
        businessBasePaise: 1260000,
        reason: 'Creating test charter flight'
      }
    });
    expect(created.statusCode).toBe(201);
    const flightId = created.json<{ id: string }>().id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/admin/flights/${flightId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { economyBasePaise: 440000, reason: 'Adjusting base economy fare' }
    });
    expect(updated.statusCode).toBe(200);

    const published = await app.inject({
      method: 'POST',
      url: `/v1/admin/flights/${flightId}/publish`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Publishing flight schedule' }
    });
    expect(published.statusCode).toBe(200);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/admin/flights/${flightId}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'Operational cancellation test' }
    });
    expect(cancelled.statusCode).toBe(200);

    await prisma.flight.delete({ where: { id: flightId } });
  });
});