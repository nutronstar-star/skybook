import type { AuditLog, Prisma } from '@skybook/database';
import { AuditRepository } from './audit.repository.js';
import type { AuditQueryInput, RecordAuditInput } from './audit.types.js';

export class AuditService {
  constructor(private readonly repo = new AuditRepository()) {}

  async record(input: RecordAuditInput, tx?: Prisma.TransactionClient): Promise<AuditLog> {
    return this.repo.insert(input, tx);
  }

  async queryLogs(query: AuditQueryInput) {
    const { items, total } = await this.repo.findPaginated(query);
    return {
      data: items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit)
      }
    };
  }

  async exportCsv(query: AuditQueryInput): Promise<string> {
    const rows = await this.repo.findForExport(query);
    const headers = [
      'id',
      'createdAt',
      'actorRole',
      'actorId',
      'entityType',
      'entityId',
      'action',
      'reason',
      'ipAddress',
      'requestId'
    ];

    const escapeCsv = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      const str = val instanceof Date ? val.toISOString() : String(val);
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.createdAt,
          r.actorRole,
          r.actorId,
          r.entityType,
          r.entityId,
          r.action,
          r.reason,
          r.ipAddress,
          r.requestId
        ]
          .map(escapeCsv)
          .join(',')
      );
    }
    return lines.join('\n');
  }
}

export const auditService = new AuditService();