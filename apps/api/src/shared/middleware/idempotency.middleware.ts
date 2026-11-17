import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma, Prisma } from '@skybook/database';
import { canonicalizeJson, DOMAIN_CONSTANTS, ErrorCode } from '@skybook/shared';
import { AppError } from '../errors/app-error.js';

declare module 'fastify' {
  interface FastifyRequest {
    idempotencyContext?: {
      actorId: string;
      key: string;
      endpoint: string;
      requestHash: string;
    };
  }
}

export async function requireIdempotencyKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const rawKey = request.headers['idempotency-key'];
  const key = Array.isArray(rawKey) ? rawKey[0]?.trim() : rawKey?.trim();

  if (!key || key.length < 8 || key.length > 128) {
    throw AppError.badRequest(
      ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      'A valid Idempotency-Key header (8-128 chars) is required for this operation'
    );
  }

  const actorId = request.authUser?.userId;
  if (!actorId) {
    throw AppError.unauthorized();
  }

  const canonicalBody = canonicalizeJson(request.body ?? {});
  const requestHash = createHash('sha256').update(canonicalBody).digest('hex');
  const endpoint = `${request.method} ${request.routeOptions.url ?? request.url}`;

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      actorId_idempotencyKey: {
        actorId,
        idempotencyKey: key
      }
    }
  });

  if (existing && existing.expiresAt > new Date()) {
    if (existing.requestHash !== requestHash) {
      throw AppError.conflict(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        'Idempotency-Key was already used with a different request payload'
      );
    }

    void reply.header('X-Idempotent-Replay', 'true');
    void reply.status(existing.responseStatus).send(existing.responseBody);
    return reply;
  }

  request.idempotencyContext = {
    actorId,
    key,
    endpoint,
    requestHash
  };
}

export async function persistIdempotencyResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown
): Promise<unknown> {
  const ctx = request.idempotencyContext;
  if (!ctx || reply.statusCode >= 500) {
    return payload;
  }

  let parsedBody: unknown = payload;
  if (typeof payload === 'string') {
    try {
      parsedBody = JSON.parse(payload);
    } catch {
      parsedBody = { raw: payload };
    }
  }

  const expiresAt = new Date(Date.now() + DOMAIN_CONSTANTS.IDEMPOTENCY_TTL_SECONDS * 1000);

  await prisma.idempotencyKey.upsert({
    where: {
      actorId_idempotencyKey: {
        actorId: ctx.actorId,
        idempotencyKey: ctx.key
      }
    },
    update: {
      responseStatus: reply.statusCode,
      responseBody: parsedBody as Prisma.InputJsonValue,
      expiresAt
    },
    create: {
      actorId: ctx.actorId,
      idempotencyKey: ctx.key,
      endpoint: ctx.endpoint,
      requestHash: ctx.requestHash,
      responseStatus: reply.statusCode,
      responseBody: parsedBody as Prisma.InputJsonValue,
      expiresAt
    }
  });

  return payload;
}