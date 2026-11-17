import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../shared/middleware/auth.middleware.js';
import { rateLimit } from '../../shared/middleware/rate-limit.middleware.js';
import { auditController } from './audit.controller.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/audit-logs',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: {
        tags: ['Admin · Audit'],
        summary: 'Query immutable audit log (FR-ADM-020)'
      }
    },
    (req, reply) => auditController.list(req, reply)
  );

  app.get(
    '/audit-logs/export.csv',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: {
        tags: ['Admin · Audit'],
        summary: 'Export filtered audit logs as CSV (FR-ADM-021)'
      }
    },
    (req, reply) => auditController.exportCsv(req, reply)
  );
}