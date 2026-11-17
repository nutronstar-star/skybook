import type { FastifyRequest } from 'fastify';
import { ErrorCode } from '@skybook/shared';
import { AppError } from '../errors/app-error.js';

export async function requireAdminReason(request: FastifyRequest): Promise<void> {
  const body = request.body as Record<string, unknown> | undefined;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (reason.length < 5) {
    throw AppError.badRequest(
      ErrorCode.REASON_REQUIRED,
      'Admin state-mutating operations require a non-empty audit reason (minimum 5 characters)'
    );
  }
}