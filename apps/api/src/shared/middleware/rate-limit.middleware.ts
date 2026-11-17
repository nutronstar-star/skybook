import type { FastifyReply, FastifyRequest } from 'fastify';
import { DOMAIN_CONSTANTS } from '@skybook/shared';
import { redis, isRedisReady } from '../redis/client.js';
import { AppError } from '../errors/app-error.js';

export type RateLimitBucket = 'auth' | 'write' | 'read';

const BUCKET_LIMITS: Record<RateLimitBucket, number> = {
  auth: DOMAIN_CONSTANTS.RATE_LIMIT_AUTH_PER_MIN,
  write: DOMAIN_CONSTANTS.RATE_LIMIT_WRITE_PER_MIN,
  read: DOMAIN_CONSTANTS.RATE_LIMIT_READ_PER_MIN
};

export function rateLimit(bucket: RateLimitBucket) {
  const maxRequests = BUCKET_LIMITS[bucket];
  const windowSeconds = 60;

  return async function rateLimitPreHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    if (!isRedisReady()) {
      return;
    }

    const identity = request.authUser?.userId ?? request.ip ?? 'anonymous';
    const windowSlot = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `rl:${bucket}:${identity}:${windowSlot}`;

    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds + 5);
    }

    const remaining = Math.max(0, maxRequests - current);
    void reply.header('X-RateLimit-Limit', String(maxRequests));
    void reply.header('X-RateLimit-Remaining', String(remaining));

    if (current > maxRequests) {
      const ttl = await redis.ttl(key);
      void reply.header('Retry-After', String(Math.max(1, ttl)));
      throw AppError.tooManyRequests(`Rate limit exceeded for ${bucket} operations`);
    }
  };
}