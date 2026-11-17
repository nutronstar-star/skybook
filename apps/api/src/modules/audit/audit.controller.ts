import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditQuerySchema } from './audit.types.js';
import { auditService } from './audit.service.js';

export class AuditController {
  async list(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = AuditQuerySchema.parse(request.query);
    const result = await auditService.queryLogs(query);
    return reply.status(200).send(result);
  }

  async exportCsv(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = AuditQuerySchema.parse(request.query);
    const csv = await auditService.exportCsv(query);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="skybook-audit-logs.csv"')
      .status(200)
      .send(csv);
  }
}

export const auditController = new AuditController();