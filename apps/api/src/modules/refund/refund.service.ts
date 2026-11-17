import { randomUUID } from 'node:crypto';
import { prisma, type Prisma } from '@skybook/database';
import { calculateRefundPercentage, ErrorCode } from '@skybook/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  assertTenantOwnership,
  type AuthenticatedActor
} from '../../shared/middleware/auth.middleware.js';
import { redis, isRedisReady } from '../../shared/redis/client.js';
import { logger } from '../../shared/logger/pii-scrubber.js';
import { auditService } from '../audit/index.js';
import { flightService } from '../flight/index.js';
import { SEAT_EVENTS_CHANNEL } from '../booking/index.js';
import { ticketService } from '../ticket/index.js';
import { notificationService } from '../notification/index.js';
import type { AdminRefundListQuery } from './refund.types.js';

interface RazorpayRefundApiResponse {
  id: string;
  status: string;
  amount: number;
}

export class RefundService {
  private computeDeterministicRefund(paidAmountPaise: number, departureTime: Date, now = new Date()) {
    const hoursBeforeDeparture = Math.max(
      0,
      Math.floor(((departureTime.getTime() - now.getTime()) / 3_600_000) * 100) / 100
    );
    const refundPercentage = calculateRefundPercentage(hoursBeforeDeparture);
    const refundAmountPaise = Math.floor((paidAmountPaise * refundPercentage) / 100);
    const cancellationFeePaise = paidAmountPaise - refundAmountPaise;

    return {
      hoursBeforeDeparture,
      refundPercentage,
      paidAmountPaise,
      refundAmountPaise,
      cancellationFeePaise
    };
  }

  /**
   * Calls Razorpay Refunds API idempotently with key derived from bookingId + tier + amount (EI-03, FR-ADM-016 AC-04).
   */
  private async executeGatewayRefund(input: {
    razorpayPaymentId: string;
    amountPaise: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<RazorpayRefundApiResponse> {
    if (env.MOCK_PAYMENT) {
      return {
        id: `rfnd_mock_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
        status: 'processed',
        amount: input.amountPaise
      };
    }

    const authHeader =
      'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');

    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(input.razorpayPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
          'X-Razorpay-Idempotency': input.idempotencyKey
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          notes: { reason: input.reason }
        }),
        signal: AbortSignal.timeout(10_000)
      }
    );

    if (!res.ok) {
      throw new Error(`Razorpay refund API HTTP ${res.status}`);
    }

    return (await res.json()) as RazorpayRefundApiResponse;
  }

  /**
   * Deterministic refund preview prior to cancellation (FR-PAX-036, S1).
   */
  async previewRefund(bookingId: string, actor: AuthenticatedActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        flight: { select: { departureTime: true, flightNumber: true } },
        paymentIntents: { where: { status: 'SUCCESS' }, take: 1 }
      }
    });

    if (!booking) {
      throw AppError.notFound('Booking not found');
    }

    assertTenantOwnership(booking.userId, actor);

    const calc = this.computeDeterministicRefund(
      booking.totalAmountPaise,
      booking.flight.departureTime
    );

    return {
      bookingId: booking.id,
      pnr: booking.pnr,
      bookingStatus: booking.status,
      cancellable: booking.status === 'CONFIRMED',
      departureTime: booking.flight.departureTime.toISOString(),
      ...calc
    };
  }

  /**
   * Passenger self-service cancellation of a CONFIRMED booking (FR-PAX-037..039, FR-PAX-035).
   */
  async cancelBookingByPassenger(
    bookingId: string,
    actor: AuthenticatedActor,
    meta: { reason?: string; ipAddress?: string; requestId?: string }
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        flight: true,
        passengers: { where: { status: 'ACTIVE' } },
        paymentIntents: {
          where: { status: { in: ['SUCCESS', 'REFUNDED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        refunds: true
      }
    });

    if (!booking) {
      throw AppError.notFound('Booking not found');
    }

    assertTenantOwnership(booking.userId, actor);

    if (booking.status !== 'CONFIRMED') {
      throw AppError.badRequest(
        ErrorCode.INVALID_TRANSITION,
        `Only CONFIRMED bookings can be cancelled (current: ${booking.status})`
      );
    }

    const successfulPayment = booking.paymentIntents[0];
    if (!successfulPayment) {
      throw AppError.badRequest(
        ErrorCode.INVALID_TRANSITION,
        'No settled payment found for this booking'
      );
    }

    const calc = this.computeDeterministicRefund(
      booking.totalAmountPaise,
      booking.flight.departureTime
    );
    const cancelReason = meta.reason ?? 'Passenger self-service cancellation';
    const seatIds = booking.passengers.map((p) => p.seatId);

    const refundRecord = await prisma.$transaction(async (tx) => {
      // 1. Transition Booking -> CANCELLED
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });

      // 2. Invalidate QR tickets (FR-PAX-035)
      await ticketService.invalidateTicketsForBooking(booking.id, tx);

      // 3. Release seats back to AVAILABLE (BR-01)
      await tx.bookingPassenger.updateMany({
        where: { bookingId: booking.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' }
      });

      if (seatIds.length > 0) {
        await tx.flightSeat.updateMany({
          where: { id: { in: seatIds }, flightId: booking.flightId },
          data: { status: 'AVAILABLE' }
        });
      }

      // 4. Create INITIATED Refund record (FR-PAX-038)
      const refund = await tx.refund.create({
        data: {
          bookingId: booking.id,
          paymentIntentId: successfulPayment.id,
          initiatedByUserId: actor.userId,
          amountPaise: calc.refundAmountPaise,
          refundPercentage: calc.refundPercentage,
          status: calc.refundAmountPaise === 0 ? 'COMPLETED' : 'INITIATED',
          reason: cancelReason
        }
      });

      // 5. Write audit log BEFORE gateway call
      await auditService.record(
        {
          actorId: actor.userId,
          actorRole: 'PASSENGER',
          entityType: 'BOOKING',
          entityId: booking.id,
          action: 'BOOKING_CANCELLED_AND_REFUND_INITIATED',
          reason: cancelReason,
          metadata: {
            pnr: booking.pnr,
            refundId: refund.id,
            refundPercentage: calc.refundPercentage,
            refundAmountPaise: calc.refundAmountPaise
          },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return refund;
    });

    await flightService.invalidateSearchCache();

    if (isRedisReady() && seatIds.length > 0) {
      await redis.publish(
        SEAT_EVENTS_CHANNEL,
        JSON.stringify({
          type: 'SEAT_AVAILABLE',
          flightId: booking.flightId,
          seatIds,
          timestamp: new Date().toISOString()
        })
      );
    }

    // Dispatch Razorpay refund request when amount > 0
    let finalRefund = refundRecord;
    if (calc.refundAmountPaise > 0 && successfulPayment.razorpayPaymentId) {
      finalRefund = await this.dispatchGatewayRefundForRecord(refundRecord.id, {
        razorpayPaymentId: successfulPayment.razorpayPaymentId,
        bookingId: booking.id,
        pnr: booking.pnr,
        userId: booking.userId,
        paymentIntentId: successfulPayment.id
      });
    }

    return {
      bookingId: booking.id,
      pnr: booking.pnr,
      bookingStatus: 'CANCELLED',
      refund: {
        id: finalRefund.id,
        status: finalRefund.status,
        refundPercentage: finalRefund.refundPercentage,
        amountPaise: finalRefund.amountPaise,
        razorpayRefundId: finalRefund.razorpayRefundId
      }
    };
  }

  private async dispatchGatewayRefundForRecord(
    refundId: string,
    ctx: {
      razorpayPaymentId: string;
      bookingId: string;
      pnr: string;
      userId: string;
      paymentIntentId: string;
    }
  ) {
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    const gatewayIdemKey = `refund_${ctx.bookingId}_${refund.refundPercentage}_${refund.amountPaise}`;

    try {
      const gw = await this.executeGatewayRefund({
        razorpayPaymentId: ctx.razorpayPaymentId,
        amountPaise: refund.amountPaise,
        idempotencyKey: gatewayIdemKey,
        reason: refund.reason
      });

      const nextStatus = env.MOCK_PAYMENT || gw.status === 'processed' ? 'COMPLETED' : 'PROCESSING';

      const updated = await prisma.$transaction(async (tx) => {
        const ref = await tx.refund.update({
          where: { id: refund.id },
          data: {
            razorpayRefundId: gw.id,
            status: nextStatus
          }
        });

        if (nextStatus === 'COMPLETED') {
          await tx.paymentIntent.update({
            where: { id: ctx.paymentIntentId },
            data: { status: 'REFUNDED' }
          });
        }

        await auditService.record(
          {
            actorId: ctx.userId,
            actorRole: 'SYSTEM',
            entityType: 'REFUND',
            entityId: ref.id,
            action: `REFUND_${nextStatus}`,
            metadata: {
              bookingId: ctx.bookingId,
              razorpayRefundId: gw.id,
              amountPaise: ref.amountPaise
            }
          },
          tx
        );

        return ref;
      });

      if (nextStatus === 'COMPLETED') {
        await notificationService.enqueueRefundCompleted({
          refundId: updated.id,
          bookingId: ctx.bookingId,
          userId: ctx.userId,
          pnr: ctx.pnr,
          amountPaise: updated.amountPaise
        });
      }

      return updated;
    } catch (err) {
      logger.error({ refundId, err: String(err) }, 'Gateway refund dispatch failed; queued for retry');
      return prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          retryCount: { increment: 1 }
        }
      });
    }
  }

  // ============================================================================
  // ADMIN REFUND WORKFLOWS (FR-ADM-016..019, FR-ADM-007)
  // ============================================================================

  async listAdminRefunds(query: AdminRefundListQuery) {
    const where: Prisma.RefundWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.bookingId ? { bookingId: query.bookingId } : {})
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      prisma.refund.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              pnr: true,
              totalAmountPaise: true,
              status: true,
              flight: { select: { flightNumber: true, departureTime: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit
      }),
      prisma.refund.count({ where })
    ]);

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

  /**
   * Admin approves a refund with mandatory reason; writes audit log BEFORE calling Razorpay (FR-ADM-016).
   */
  async approveRefundByAdmin(
    refundId: string,
    reason: string,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        booking: { include: { flight: true } },
        paymentIntent: true
      }
    });

    if (!refund) {
      throw AppError.notFound('Refund not found');
    }

    // FR-ADM-016 AC-06: Prevent duplicate approval / double refund
    if (refund.status === 'PROCESSING' || refund.status === 'COMPLETED' || refund.razorpayRefundId) {
      throw AppError.conflict(
        ErrorCode.REFUND_ALREADY_INITIATED,
        `Refund has already been initiated or completed (status: ${refund.status})`
      );
    }

    // FR-ADM-016 AC-03: Amount is strictly calculated by the deterministic tier formula
    const calc = this.computeDeterministicRefund(
      refund.booking.totalAmountPaise,
      refund.booking.flight.departureTime
    );

    // FR-ADM-016 AC-02: Write audit log BEFORE gateway refund call
    await prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          approvedByAdminId: meta.adminUserId,
          amountPaise: calc.refundAmountPaise,
          refundPercentage: calc.refundPercentage,
          status: 'INITIATED'
        }
      });

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'REFUND',
          entityId: refund.id,
          action: 'ADMIN_REFUND_APPROVED',
          reason,
          metadata: {
            bookingId: refund.bookingId,
            pnr: refund.booking.pnr,
            amountPaise: calc.refundAmountPaise,
            refundPercentage: calc.refundPercentage
          },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
    });

    if (calc.refundAmountPaise > 0 && refund.paymentIntent.razorpayPaymentId) {
      return this.dispatchGatewayRefundForRecord(refund.id, {
        razorpayPaymentId: refund.paymentIntent.razorpayPaymentId,
        bookingId: refund.bookingId,
        pnr: refund.booking.pnr,
        userId: refund.booking.userId,
        paymentIntentId: refund.paymentIntentId
      });
    }

    return prisma.refund.update({
      where: { id: refund.id },
      data: { status: 'COMPLETED' }
    });
  }

  /**
   * Admin rejects a refund request with mandatory reason, keeping booking state intact (FR-ADM-017).
   */
  async rejectRefundByAdmin(
    refundId: string,
    reason: string,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const refund = await prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund) {
      throw AppError.notFound('Refund not found');
    }

    if (refund.status === 'COMPLETED' || refund.status === 'PROCESSING') {
      throw AppError.badRequest(
        ErrorCode.INVALID_TRANSITION,
        `Cannot reject a refund in ${refund.status} state`
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: 'REJECTED',
          approvedByAdminId: meta.adminUserId
        }
      });

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'REFUND',
          entityId: refund.id,
          action: 'ADMIN_REFUND_REJECTED',
          reason,
          metadata: { bookingId: refund.bookingId },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return updated;
    });
  }

  /**
   * Idempotent retry for FAILED or stuck INITIATED refunds (FR-ADM-019, EI-03).
   */
  async retryRefund(
    refundId: string,
    meta: { adminUserId?: string; reason: string; ipAddress?: string; requestId?: string }
  ) {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        booking: true,
        paymentIntent: true
      }
    });

    if (!refund) {
      throw AppError.notFound('Refund not found');
    }

    if (refund.status === 'COMPLETED' || refund.status === 'REJECTED') {
      return refund;
    }

    await auditService.record({
      actorId: meta.adminUserId ?? null,
      actorRole: meta.adminUserId ? 'ADMIN' : 'SYSTEM',
      entityType: 'REFUND',
      entityId: refund.id,
      action: 'REFUND_RETRY_TRIGGERED',
      reason: meta.reason,
      metadata: { attempt: refund.retryCount + 1 },
      ipAddress: meta.ipAddress,
      requestId: meta.requestId
    });

    if (refund.amountPaise > 0 && refund.paymentIntent.razorpayPaymentId) {
      return this.dispatchGatewayRefundForRecord(refund.id, {
        razorpayPaymentId: refund.paymentIntent.razorpayPaymentId,
        bookingId: refund.bookingId,
        pnr: refund.booking.pnr,
        userId: refund.booking.userId,
        paymentIntentId: refund.paymentIntentId
      });
    }

    return refund;
  }

  /**
   * Webhook handler for Razorpay refund.processed / refund.failed events.
   */
  async handleGatewayRefundWebhook(
    razorpayRefundId: string,
    status: 'COMPLETED' | 'FAILED',
    tx: Prisma.TransactionClient
  ): Promise<void> {
    const refund = await tx.refund.findUnique({
      where: { razorpayRefundId },
      include: { booking: true }
    });
    if (!refund || refund.status === 'COMPLETED') return;

    await tx.refund.update({
      where: { id: refund.id },
      data: { status }
    });

    if (status === 'COMPLETED') {
      await tx.paymentIntent.update({
        where: { id: refund.paymentIntentId },
        data: { status: 'REFUNDED' }
      });

      await notificationService.enqueueRefundCompleted({
        refundId: refund.id,
        bookingId: refund.bookingId,
        userId: refund.booking.userId,
        pnr: refund.booking.pnr,
        amountPaise: refund.amountPaise
      });
    }
  }

  /**
   * Cascading 100% refunds when Admin cancels an entire flight (FR-ADM-007).
   */
  async handleFlightCancelledCascade(event: {
    flightId: string;
    flightNumber: string;
    adminUserId: string;
    reason: string;
  }): Promise<void> {
    const confirmedBookings = await prisma.booking.findMany({
      where: { flightId: event.flightId, status: 'CONFIRMED' },
      include: {
        passengers: { where: { status: 'ACTIVE' } },
        paymentIntents: { where: { status: 'SUCCESS' }, take: 1 }
      }
    });

    for (const booking of confirmedBookings) {
      const payment = booking.paymentIntents[0];
      if (!payment) continue;

      const refund = await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'CANCELLED', cancelledAt: new Date() }
        });

        await ticketService.invalidateTicketsForBooking(booking.id, tx);

        await tx.bookingPassenger.updateMany({
          where: { bookingId: booking.id, status: 'ACTIVE' },
          data: { status: 'CANCELLED' }
        });

        const created = await tx.refund.create({
          data: {
            bookingId: booking.id,
            paymentIntentId: payment.id,
            initiatedByUserId: event.adminUserId,
            approvedByAdminId: event.adminUserId,
            amountPaise: booking.totalAmountPaise,
            refundPercentage: 100,
            status: 'INITIATED',
            reason: `Flight ${event.flightNumber} cancelled: ${event.reason}`
          }
        });

        await auditService.record(
          {
            actorId: event.adminUserId,
            actorRole: 'ADMIN',
            entityType: 'REFUND',
            entityId: created.id,
            action: 'FLIGHT_CANCELLATION_FULL_REFUND_INITIATED',
            reason: event.reason,
            metadata: { bookingId: booking.id, pnr: booking.pnr }
          },
          tx
        );

        return created;
      });

      if (payment.razorpayPaymentId) {
        await this.dispatchGatewayRefundForRecord(refund.id, {
          razorpayPaymentId: payment.razorpayPaymentId,
          bookingId: booking.id,
          pnr: booking.pnr,
          userId: booking.userId,
          paymentIntentId: payment.id
        });
      }
    }
  }
}

export const refundService = new RefundService();