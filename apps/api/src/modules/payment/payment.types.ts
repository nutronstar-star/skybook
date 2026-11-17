import { z } from 'zod';
import type { Prisma } from '@skybook/database';

export const PaymentBookingIdParamSchema = z.object({
  bookingId: z.string().uuid()
});

export const RazorpayWebhookEnvelopeSchema = z.object({
  event: z.string().min(1),
  created_at: z.number().optional(),
  payload: z.record(z.unknown())
});

export type RazorpayWebhookEnvelope = z.infer<typeof RazorpayWebhookEnvelopeSchema>;

export interface PaymentSucceededContext {
  bookingId: string;
  userId: string;
  paymentIntentId: string;
  razorpayPaymentId: string;
}

export type PaymentSucceededHook = (
  ctx: PaymentSucceededContext,
  tx: Prisma.TransactionClient
) => Promise<void>;

export interface RefundProcessedContext {
  razorpayRefundId: string;
  status: 'COMPLETED' | 'FAILED';
}

export type RefundProcessedHook = (
  ctx: RefundProcessedContext,
  tx: Prisma.TransactionClient
) => Promise<void>;

export type EnqueueWebhookJobFn = (webhookEventId: string) => Promise<void>;