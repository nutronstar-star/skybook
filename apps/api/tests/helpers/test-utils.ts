import type { FastifyInstance } from 'fastify';
import { prisma } from '@skybook/database';
import { redis } from '../../src/shared/redis/client.js';

export async function clearRedisTestKeys(): Promise<void> {
  const patterns = ['rl:*', 'lock:*', 'flights:search:*', 'revoked:*'];
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

export async function loginPassengerWithPhone(
  app: FastifyInstance,
  phone: string,
  fullName?: string
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  await prisma.otpChallenge.deleteMany({});
  const reqRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/otp/request',
    payload: { phone }
  });
  if (reqRes.statusCode !== 200) {
    throw new Error(`OTP request failed (${reqRes.statusCode}): ${reqRes.body}`);
  }
  const { mockOtp } = reqRes.json<{ mockOtp: string }>();

  const verRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, otp: mockOtp, ...(fullName ? { fullName } : {}) }
  });
  if (verRes.statusCode !== 200) {
    throw new Error(`OTP verify failed (${verRes.statusCode}): ${verRes.body}`);
  }
  const body = verRes.json<{
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  }>();
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id
  };
}

export async function loginDefaultAdmin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/admin/login',
    payload: {
      email: 'admin@skybook.in',
      password: 'SkyBook@Admin2026!#'
    }
  });
  if (res.statusCode !== 200) {
    throw new Error(`Admin login failed (${res.statusCode}): ${res.body}`);
  }
  return res.json<{ accessToken: string }>().accessToken;
}

export async function cleanupBookingArtifacts(params: {
  bookingId?: string;
  lockGroupId?: string;
  seatIds?: string[];
  eventId?: string;
}): Promise<void> {
  if (params.bookingId) {
    await prisma.refund.deleteMany({ where: { bookingId: params.bookingId } });
    await prisma.ticket.deleteMany({ where: { bookingId: params.bookingId } });
    await prisma.paymentIntent.deleteMany({ where: { bookingId: params.bookingId } });
    await prisma.booking.deleteMany({ where: { id: params.bookingId } });
  }
  if (params.eventId) {
    await prisma.webhookEvent.deleteMany({ where: { eventId: params.eventId } });
  }
  if (params.lockGroupId) {
    await prisma.seatLock.deleteMany({ where: { lockGroupId: params.lockGroupId } });
  }
  if (params.seatIds && params.seatIds.length > 0) {
    await prisma.flightSeat.updateMany({
      where: { id: { in: params.seatIds } },
      data: { status: 'AVAILABLE' }
    });
  }
}