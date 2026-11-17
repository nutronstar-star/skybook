import type { FastifyInstance } from 'fastify';
import { requireAdmin, requirePassenger } from '../../shared/middleware/auth.middleware.js';
import { requireAdminReason } from '../../shared/middleware/admin-reason.middleware.js';
import { rateLimit } from '../../shared/middleware/rate-limit.middleware.js';
import { refundController } from './refund.controller.js';

export async function refundRoutes(app: FastifyInstance): Promise<void> {
  // Passenger Cancellation & Refund Preview (FR-PAX-036..039)
  app.get(
    '/bookings/:id/refund-preview',
    {
      preHandler: [requirePassenger, rateLimit('read')],
      schema: {
        tags: ['Passenger · Refunds'],
        summary: 'Preview deterministic refund tier before cancellation (FR-PAX-036)'
      }
    },
    (req, reply) => refundController.previewRefund(req, reply)
  );

  app.post(
    '/bookings/:id/cancel',
    {
      preHandler: [requirePassenger, rateLimit('write')],
      schema: {
        tags: ['Passenger · Refunds'],
        summary: 'Cancel CONFIRMED booking & initiate deterministic refund (FR-PAX-037..039)'
      }
    },
    (req, reply) => refundController.cancelBooking(req, reply)
  );

  // Admin Refund Management (FR-ADM-016..019)
  app.get(
    '/admin/refunds',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: {
        tags: ['Admin · Refunds'],
        summary: 'List all refunds with status filter (FR-ADM-018)'
      }
    },
    (req, reply) => refundController.adminListRefunds(req, reply)
  );

  app.post(
    '/admin/refunds/:id/approve',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: {
        tags: ['Admin · Refunds'],
        summary: 'Approve refund with mandatory reason (FR-ADM-016)'
      }
    },
    (req, reply) => refundController.adminApproveRefund(req, reply)
  );

  app.post(
    '/admin/refunds/:id/reject',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: {
        tags: ['Admin · Refunds'],
        summary: 'Reject refund request with mandatory reason (FR-ADM-017)'
      }
    },
    (req, reply) => refundController.adminRejectRefund(req, reply)
  );

  app.post(
    '/admin/refunds/:id/retry',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: {
        tags: ['Admin · Refunds'],
        summary: 'Idempotently retry failed gateway refund (FR-ADM-019)'
      }
    },
    (req, reply) => refundController.adminRetryRefund(req, reply)
  );
}