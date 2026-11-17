import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../security/jwt.js';
import { isSessionInvalidated } from '../redis/client.js';
import { AppError } from '../errors/app-error.js';

export interface AuthenticatedActor {
  userId: string;
  sessionId: string;
  role: 'PASSENGER' | 'ADMIN';
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedActor;
  }
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) return;

  try {
    const claims = await verifyAccessToken(token);
    const invalidated = await isSessionInvalidated(claims.sid, claims.sub, claims.iat);
    if (!invalidated) {
      request.authUser = {
        userId: claims.sub,
        sessionId: claims.sid,
        role: claims.role
      };
    }
  } catch {
    // Ignore invalid tokens in optionalAuth
  }
}

export async function requireAuth(request: FastifyRequest): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    throw AppError.unauthorized('Missing or malformed Authorization header');
  }

  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw AppError.unauthorized('Access token is invalid or expired');
  }

  const invalidated = await isSessionInvalidated(claims.sid, claims.sub, claims.iat);
  if (invalidated) {
    throw AppError.unauthorized('Session has been revoked');
  }

  request.authUser = {
    userId: claims.sub,
    sessionId: claims.sid,
    role: claims.role
  };
}

export async function requirePassenger(request: FastifyRequest): Promise<void> {
  await requireAuth(request);
  if (request.authUser?.role !== 'PASSENGER') {
    throw AppError.notFound();
  }
}

export async function requireAdmin(request: FastifyRequest): Promise<void> {
  await requireAuth(request);
  if (request.authUser?.role !== 'ADMIN') {
    throw AppError.notFound();
  }
}

/**
 * FR-XC-002 & BR-09: Cross-tenant access MUST return 404 (never 403) to prevent existence disclosure.
 */
export function assertTenantOwnership(
  resourceOwnerId: string | null | undefined,
  actor: AuthenticatedActor
): void {
  if (actor.role === 'ADMIN') return;
  if (!resourceOwnerId || resourceOwnerId !== actor.userId) {
    throw AppError.notFound();
  }
}