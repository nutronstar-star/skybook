import { z } from 'zod';
import { BookingStatusSchema } from '@skybook/shared';

export const LockIdParamSchema = z.object({
  lockId: z.string().uuid()
});

export const BookingIdParamSchema = z.object({
  id: z.string().uuid()
});

export const AdminBookingListQuerySchema = z.object({
  status: BookingStatusSchema.optional(),
  flightId: z.string().uuid().optional(),
  pnr: z.string().trim().toUpperCase().max(6).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export type AdminBookingListQuery = z.infer<typeof AdminBookingListQuerySchema>;

export interface SeatRealtimeEvent {
  type: 'SEAT_LOCKED' | 'SEAT_RELEASED' | 'SEAT_BOOKED' | 'SEAT_AVAILABLE';
  flightId: string;
  seatIds: string[];
  expiresAt?: string;
  timestamp: string;
}

export const SEAT_EVENTS_CHANNEL = 'skybook:seat-events';