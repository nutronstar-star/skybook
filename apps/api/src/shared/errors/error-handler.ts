import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { ErrorCode, type ApiErrorResponse } from '@skybook/shared';
import { AppError } from './app-error.js';
import { scrubPiiString } from '../logger/pii-scrubber.js';

export function globalErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const requestId = request.id;

  if (error instanceof AppError) {
    const body: ApiErrorResponse = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
        requestId
      }
    };
    void reply.status(error.statusCode).send(body);
    return;
  }

  if (error instanceof ZodError) {
    const body: ApiErrorResponse = {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: error.flatten(),
        requestId
      }
    };
    void reply.status(422).send(body);
    return;
  }

  // Prisma Unique Constraint Violation (e.g., partial unique seat lock or active seat booking)
  const maybePrisma = error as { code?: string; meta?: unknown };
  if (maybePrisma.code === 'P2002') {
    const body: ApiErrorResponse = {
      error: {
        code: ErrorCode.SEAT_LOCKED,
        message: 'Requested resource or seat is already locked or booked',
        requestId
      }
    };
    void reply.status(409).send(body);
    return;
  }

  // Fastify schema validation error
  if ('validation' in error && error.validation) {
    const body: ApiErrorResponse = {
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid request parameters',
        details: error.validation,
        requestId
      }
    };
    void reply.status(400).send(body);
    return;
  }

  request.log.error({ err: scrubPiiString(error.message), requestId }, 'Unhandled server error');

  // NFR-U-04: Never expose raw stack traces or internal database details
  const body: ApiErrorResponse = {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred while processing your request',
      requestId
    }
  };
  void reply.status(500).send(body);
}