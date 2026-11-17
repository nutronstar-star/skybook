import { z } from 'zod';
import type { AuditActorRole, Prisma } from '@skybook/database';

export interface RecordAuditInput {
  actorId?: string | null;
  actorRole: AuditActorRole;
  entityType: string;
  entityId: string;
  action: string;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  requestId?: string | null;
}

export const AuditQuerySchema = z.object({
  entityType: z.string().trim().optional(),
  entityId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export type AuditQueryInput = z.infer<typeof AuditQuerySchema>;