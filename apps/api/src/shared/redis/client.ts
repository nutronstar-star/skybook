import { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { logger } from '../logger/pii-scrubber.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false
});

redis.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'Redis connection error');
});

export function isRedisReady(): boolean {
  return redis.status === 'ready';
}

/**
 * Session revocation helpers enforcing FR-XC-006 & NFR-S-08 (< 5s global revocation cascade).
 */
export async function markSessionRevoked(sessionId: string, ttlSeconds: number): Promise<void> {
  if (!isRedisReady()) return;
  await redis.set(`revoked:session:${sessionId}`, '1', 'EX', Math.max(ttlSeconds, 60));
}

export async function revokeAllUserSessionsAfter(userId: string, ttlSeconds: number): Promise<void> {
  if (!isRedisReady()) return;
  const nowSec = Math.floor(Date.now() / 1000);
  await redis.set(`revoked:user_before:${userId}`, String(nowSec), 'EX', Math.max(ttlSeconds, 900));
}

export async function isSessionInvalidated(
  sessionId: string,
  userId: string,
  tokenIssuedAtSec?: number
): Promise<boolean> {
  if (!isRedisReady()) return false;
  const [sessionRevoked, userRevokedBefore] = await redis.mget(
    `revoked:session:${sessionId}`,
    `revoked:user_before:${userId}`
  );
  if (sessionRevoked === '1') return true;
  if (userRevokedBefore && tokenIssuedAtSec !== undefined) {
    const cutoff = Number(userRevokedBefore);
    if (!Number.isNaN(cutoff) && tokenIssuedAtSec <= cutoff) {
      return true;
    }
  }
  return false;
}