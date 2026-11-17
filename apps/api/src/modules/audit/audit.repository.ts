import { prisma, type Prisma, type AuditLog } from '@skybook/database';
import type { AuditQueryInput, RecordAuditInput } from './audit.types.js';

export class AuditRepository {
  async insert(input: RecordAuditInput, tx?: Prisma.TransactionClient): Promise<AuditLog> {
    const client = tx ?? prisma;
    return client.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        reason: input.reason ?? null,
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress ?? null,
        requestId: input.requestId ?? null
      }
    });
  }

  private buildWhere(query: AuditQueryInput): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.action) where.action = query.action;
    if (query.actorId) where.actorId = query.actorId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {})
      };
    }
    return where;
  }

  async findPaginated(query: AuditQueryInput): Promise<{ items: AuditLog[]; total: number }> {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit
      }),
      prisma.auditLog.count({ where })
    ]);

    return { items, total };
  }

  async findForExport(query: AuditQueryInput, maxRows = 5000): Promise<AuditLog[]> {
    const where = this.buildWhere(query);
    return prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: maxRows
    });
  }
}