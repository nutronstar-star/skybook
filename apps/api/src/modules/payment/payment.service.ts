import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma, type Prisma } from '@skybook/database';
import { ErrorCode } from '@skybook/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  assertTenantOwnership,
  type AuthenticatedActor
} from '../../shared/middleware/auth.middleware.js';
import { logger } from '../../shared/logger/pii-scrubber.js';
import { auditService } from '../audit/index.js';
import { bookingService } from '../booking/index.js';
import { PaymentRepository } from './payment.repository.js';
import {
  RazorpayWebhookEnvelopeSchema,
  type EnqueueWebhookJobFn,
  type PaymentSucceededHook,
  type RefundProcessedHook
} from './payment.types.js';

interface RazorpayOrderApiResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export class PaymentService {
  private readonly paymentSucceededHooks: PaymentSucceededHook[] = [];
  private readonly refundProcessedHooks: RefundProcessedHook[] = [];
  private enqueueWebhookJob: EnqueueWebhookJobFn | null = null;

  constructor(private readonly repo = new PaymentRepository()) {}

  onPaymentSucceeded(hook: PaymentSucceededHook): void {
    this.paymentSucceededHooks.push(hook);
  }

  onRefundProcessed(hook: RefundProcessedHook): void {
    this.refundProcessedHooks.push(hook);
  }

  setWebhookEnqueuer(fn: EnqueueWebhookJobFn): void {
    this.enqueueWebhookJob = fn;
  }

  /**
   * Calls Razorpay Orders API with 10s timeout and 3x exponential backoff (EI-01).
   */
  private async createGatewayOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrderApiResponse> {
    if (env.MOCK_PAYMENT) {
      return {
        id: `order_mock_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
        amount: input.amountPaise,
        currency: input.currency,
        status: 'created'
      };
    }

    const authHeader =
      'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            amount: input.amountPaise,
            currency: input.currency,
            receipt: input.receipt,
            notes: input.notes
          }),
          signal: AbortSignal.timeout(10_000)
        });

        if (!res.ok) {
          throw new Error(`Razorpay order API HTTP ${res.status}`);
        }

        return (await res.json()) as RazorpayOrderApiResponse;
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
        }
      }
    }

    logger.error({ err: String(lastError) }, 'Razorpay order creation failed after 3 attempts');
    throw AppError.serviceUnavailable(
      ErrorCode.PAYMENTS_UNAVAILABLE,
      'Payment gateway is temporarily unavailable; please retry shortly'
    );
  }

  /**
   * Initiates a Razorpay order bound strictly to the server-side booking total (FR-PAX-025, FR-PAX-028).
   */
  async initiatePaymentOrder(
    bookingId: string,
    actor: AuthenticatedActor,
    meta: { ipAddress?: string; requestId?: string }
  ) {
    const booking = await this.repo.findBookingForPayment(bookingId);
    if (!booking) {
      throw AppError.notFound('Booking not found');
    }

    // FR-XC-002: Cross-tenant access returns 404
    assertTenantOwnership(booking.userId, actor);

    if (booking.status !== 'PENDING') {
      throw AppError.badRequest(
        ErrorCode.INVALID_TRANSITION,
        `Cannot initiate payment for booking in ${booking.status} state`
      );
    }

    // If an active PENDING payment intent already exists, return it so checkout can resume
    const existingPending = booking.paymentIntents.find((p) => p.status === 'PENDING');
    if (existingPending) {
      return {
        paymentIntentId: existingPending.id,
        bookingId: booking.id,
        pnr: booking.pnr,
        razorpayOrderId: existingPending.razorpayOrderId,
        razorpayKeyId: env.RAZORPAY_KEY_ID,
        amountPaise: existingPending.amountPaise,
        currency: existingPending.currency,
        status: existingPending.status,
        mockMode: env.MOCK_PAYMENT
      };
    }

    // Amount comes strictly from DB booking record (FR-PAX-025 AC-06)
    const gatewayOrder = await this.createGatewayOrder({
      amountPaise: booking.totalAmountPaise,
      currency: booking.currency,
      receipt: `skybook_${booking.pnr}`,
      notes: {
        bookingId: booking.id,
        pnr: booking.pnr
      }
    });

    const intent = await prisma.$transaction(async (tx) => {
      const created = await this.repo.createPaymentIntent(
        {
          bookingId: booking.id,
          userId: actor.userId,
          razorpayOrderId: gatewayOrder.id,
          amountPaise: booking.totalAmountPaise,
          currency: booking.currency
        },
        tx
      );

      await auditService.record(
        {
          actorId: actor.userId,
          actorRole: 'PASSENGER',
          entityType: 'PAYMENT_INTENT',
          entityId: created.id,
          action: 'PAYMENT_ORDER_CREATED',
          metadata: {
            bookingId: booking.id,
            pnr: booking.pnr,
            razorpayOrderId: created.razorpayOrderId,
            amountPaise: created.amountPaise
          },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return created;
    });

    return {
      paymentIntentId: intent.id,
      bookingId: booking.id,
      pnr: booking.pnr,
      razorpayOrderId: intent.razorpayOrderId,
      razorpayKeyId: env.RAZORPAY_KEY_ID,
      amountPaise: intent.amountPaise,
      currency: intent.currency,
      status: intent.status,
      mockMode: env.MOCK_PAYMENT
    };
  }

  /**
   * Returns current payment status for a booking (FR-PAX-029).
   */
  async getPaymentStatus(bookingId: string, actor: AuthenticatedActor) {
    const booking = await this.repo.findBookingForPayment(bookingId);
    if (!booking) {
      throw AppError.notFound('Booking not found');
    }

    assertTenantOwnership(booking.userId, actor);

    const latest = booking.paymentIntents[0] ?? null;

    return {
      bookingId: booking.id,
      pnr: booking.pnr,
      bookingStatus: booking.status,
      paymentStatus: latest?.status ?? 'PENDING',
      latestPayment: latest
        ? {
            id: latest.id,
            razorpayOrderId: latest.razorpayOrderId,
            razorpayPaymentId: latest.razorpayPaymentId,
            amountPaise: latest.amountPaise,
            currency: latest.currency,
            status: latest.status,
            paymentMethod: latest.paymentMethod,
            failureReason: latest.failureReason,
            updatedAt: latest.updatedAt.toISOString()
          }
        : null,
      attemptsCount: booking.paymentIntents.length
    };
  }

  /**
   * Verifies Razorpay HMAC-SHA256 webhook signature over raw body, deduplicates by eventId,
   * and enqueues processing onto BullMQ webhook-worker (FR-PAX-027, FR-PAX-030, EI-02).
   */
  async ingestRazorpayWebhook(input: {
    rawBody: Buffer;
    signatureHeader?: string;
    eventIdHeader?: string;
  }) {
    if (!input.signatureHeader) {
      throw AppError.badRequest(
        ErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'Missing X-Razorpay-Signature header'
      );
    }

    const expectedHex = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(input.rawBody)
      .digest('hex');

    const providedHex = input.signatureHeader.trim().toLowerCase();
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = Buffer.from(providedHex, 'hex');

    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw AppError.badRequest(
        ErrorCode.INVALID_WEBHOOK_SIGNATURE,
        'Razorpay webhook signature verification failed'
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw AppError.badRequest(ErrorCode.VALIDATION_ERROR, 'Webhook body must be valid JSON');
    }

    const envelope = RazorpayWebhookEnvelopeSchema.parse(parsedJson);
    const eventId =
      input.eventIdHeader && input.eventIdHeader.trim().length > 0
        ? input.eventIdHeader.trim()
        : `evt_${createHash('sha256').update(input.rawBody).digest('hex').slice(0, 32)}`;

    // Deduplicate repeated deliveries of the same webhook event (FR-PAX-030)
    const existing = await this.repo.findWebhookEventByEventId(eventId);
    if (existing) {
      return {
        received: true,
        duplicate: true,
        eventId,
        webhookEventId: existing.id
      };
    }

    let createdEvent;
    try {
      createdEvent = await this.repo.createWebhookEvent({
        eventId,
        eventType: envelope.event,
        payload: envelope as unknown as Prisma.InputJsonValue
      });
    } catch (err) {
      const maybePrisma = err as { code?: string };
      if (maybePrisma.code === 'P2002') {
        const concurrent = await this.repo.findWebhookEventByEventId(eventId);
        return {
          received: true,
          duplicate: true,
          eventId,
          webhookEventId: concurrent?.id
        };
      }
      throw err;
    }

    if (this.enqueueWebhookJob) {
      await this.enqueueWebhookJob(createdEvent.id);
    } else {
      await this.processWebhookEventById(createdEvent.id);
    }

    return {
      received: true,
      duplicate: false,
      eventId,
      webhookEventId: createdEvent.id
    };
  }

  /**
   * Idempotent webhook processor invoked by BullMQ webhook-worker (FR-PAX-027, FR-PAX-030, BR-04).
   */
  async processWebhookEventById(webhookEventId: string): Promise<void> {
    const eventRecord = await this.repo.findWebhookEventById(webhookEventId);
    if (!eventRecord || eventRecord.status === 'PROCESSED') {
      return;
    }

    const envelope = eventRecord.payload as {
      event: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            method?: string;
            error_description?: string;
          };
        };
        refund?: {
          entity?: {
            id?: string;
            status?: string;
          };
        };
      };
    };

    try {
      if (envelope.event === 'payment.captured') {
        const entity = envelope.payload?.payment?.entity;
        const orderId = entity?.order_id;
        const razorpayPaymentId = entity?.id ?? `pay_mock_${randomUUID().slice(0, 14)}`;
        const method = entity?.method ?? 'card';

        if (!orderId) {
          throw new Error('Missing payment.entity.order_id in payment.captured webhook');
        }

        await prisma.$transaction(async (tx) => {
          const intent = await this.repo.findPaymentIntentByOrderId(orderId, tx);
          if (!intent) {
            throw new Error(`No PaymentIntent found for razorpayOrderId=${orderId}`);
          }

          if (intent.status !== 'SUCCESS') {
            await tx.paymentIntent.update({
              where: { id: intent.id },
              data: {
                status: 'SUCCESS',
                razorpayPaymentId,
                paymentMethod: method
              }
            });

            // Transition Booking PENDING -> CONFIRMED (BR-04, FR-PAX-027)
            await bookingService.confirmBookingInternal(intent.bookingId, tx);

            // Notify downstream modules (Wave 4B: Ticket issuance + Email confirmation)
            for (const hook of this.paymentSucceededHooks) {
              await hook(
                {
                  bookingId: intent.bookingId,
                  userId: intent.userId,
                  paymentIntentId: intent.id,
                  razorpayPaymentId
                },
                tx
              );
            }

            await auditService.record(
              {
                actorId: intent.userId,
                actorRole: 'SYSTEM',
                entityType: 'BOOKING',
                entityId: intent.bookingId,
                action: 'PAYMENT_CAPTURED_AND_BOOKING_CONFIRMED',
                metadata: {
                  paymentIntentId: intent.id,
                  razorpayOrderId: orderId,
                  razorpayPaymentId,
                  method
                }
              },
              tx
            );
          }

          await tx.webhookEvent.update({
            where: { id: eventRecord.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date()
            }
          });
        });
        return;
      }

      if (envelope.event === 'payment.failed') {
        const entity = envelope.payload?.payment?.entity;
        const orderId = entity?.order_id;
        const reason = entity?.error_description ?? 'Payment declined by gateway';

        if (orderId) {
          await prisma.$transaction(async (tx) => {
            const intent = await this.repo.findPaymentIntentByOrderId(orderId, tx);
            if (intent && intent.status === 'PENDING') {
              await tx.paymentIntent.update({
                where: { id: intent.id },
                data: {
                  status: 'FAILED',
                  failureReason: reason
                }
              });

              await auditService.record(
                {
                  actorId: intent.userId,
                  actorRole: 'SYSTEM',
                  entityType: 'PAYMENT_INTENT',
                  entityId: intent.id,
                  action: 'PAYMENT_FAILED',
                  reason,
                  metadata: { bookingId: intent.bookingId, razorpayOrderId: orderId }
                },
                tx
              );
            }

            await tx.webhookEvent.update({
              where: { id: eventRecord.id },
              data: {
                status: 'PROCESSED',
                processedAt: new Date()
              }
            });
          });
        }
        return;
      }

      if (envelope.event === 'refund.processed' || envelope.event === 'refund.failed') {
        const refundEntity = envelope.payload?.refund?.entity;
        const razorpayRefundId = refundEntity?.id;
        const status = envelope.event === 'refund.processed' ? 'COMPLETED' : 'FAILED';

        await prisma.$transaction(async (tx) => {
          if (razorpayRefundId) {
            for (const hook of this.refundProcessedHooks) {
              await hook({ razorpayRefundId, status }, tx);
            }
          }

          await tx.webhookEvent.update({
            where: { id: eventRecord.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date()
            }
          });
        });
        return;
      }

      // Acknowledge unhandled Razorpay event types cleanly
      await prisma.webhookEvent.update({
        where: { id: eventRecord.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date()
        }
      });
    } catch (err) {
      await prisma.webhookEvent.update({
        where: { id: eventRecord.id },
        data: {
          status: 'FAILED',
          errorDetail: err instanceof Error ? err.message : String(err)
        }
      });
      throw err;
    }
  }
}

export const paymentService = new PaymentService();