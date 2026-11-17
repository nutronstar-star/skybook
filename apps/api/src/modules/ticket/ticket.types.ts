import { z } from 'zod';

export const TicketBookingIdParamSchema = z.object({
  bookingId: z.string().uuid()
});

export const VerifyTicketRequestSchema = z.object({
  qrToken: z.string().min(10)
});