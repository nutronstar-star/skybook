import { z } from 'zod';
import { RefundStatusSchema } from '@skybook/shared';

export const RefundBookingIdParamSchema = z.object({
  id: z.string().uuid()
});

export const RefundIdParamSchema = z.object({
  id: z.string().uuid()
});

export const PassengerCancelBookingSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional()
});

export const AdminRefundListQuerySchema = z.object({
  status: RefundStatusSchema.optional(),
  bookingId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export type AdminRefundListQuery = z.infer<typeof AdminRefundListQuerySchema>;