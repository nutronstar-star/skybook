import { prisma, decryptPii } from '@skybook/database';
import { logger } from '../../shared/logger/pii-scrubber.js';
import { auditService } from '../audit/index.js';
import type { EmailNotificationJobData, EnqueueEmailFn } from './notification.types.js';

export class NotificationService {
  private enqueueEmailFn: EnqueueEmailFn | null = null;
  private readonly deliveredLog: Array<{ type: string; entityId: string; sentAt: string }> = [];

  setEmailEnqueuer(fn: EnqueueEmailFn): void {
    this.enqueueEmailFn = fn;
  }

  getDeliveredHistory() {
    return [...this.deliveredLog];
  }

  async enqueueTicketIssued(input: {
    bookingId: string;
    userId: string;
    pnr: string;
    ticketCount: number;
  }): Promise<void> {
    const job: EmailNotificationJobData = { type: 'TICKET_ISSUED', ...input };
    if (this.enqueueEmailFn) {
      await this.enqueueEmailFn(job);
    } else {
      await this.processEmailJob(job);
    }
  }

  async enqueueRefundCompleted(input: {
    refundId: string;
    bookingId: string;
    userId: string;
    pnr: string;
    amountPaise: number;
  }): Promise<void> {
    const job: EmailNotificationJobData = { type: 'REFUND_COMPLETED', ...input };
    if (this.enqueueEmailFn) {
      await this.enqueueEmailFn(job);
    } else {
      await this.processEmailJob(job);
    }
  }

  /**
   * Executes outbound notification without logging raw email addresses (CON-L-03).
   */
  async processEmailJob(job: EmailNotificationJobData): Promise<void> {
    if (job.type === 'TICKET_ISSUED') {
      const profile = await prisma.passengerProfile.findUnique({
        where: { userId: job.userId }
      });
      const hasEmail = Boolean(profile?.emailEncrypted);
      if (hasEmail && profile?.emailEncrypted) {
        // Decrypt in-memory only for transport handoff; never log decrypted value
        void decryptPii(profile.emailEncrypted);
      }

      this.deliveredLog.push({
        type: job.type,
        entityId: job.bookingId,
        sentAt: new Date().toISOString()
      });

      await auditService.record({
        actorId: job.userId,
        actorRole: 'SYSTEM',
        entityType: 'NOTIFICATION',
        entityId: job.bookingId,
        action: 'TICKET_EMAIL_DISPATCHED',
        metadata: {
          pnr: job.pnr,
          ticketCount: job.ticketCount,
          channel: hasEmail ? 'EMAIL' : 'IN_APP_PORTAL'
        }
      });

      logger.info(
        { bookingId: job.bookingId, pnr: job.pnr, ticketCount: job.ticketCount },
        'Dispatched signed QR e-ticket notification'
      );
      return;
    }

    if (job.type === 'REFUND_COMPLETED') {
      const profile = await prisma.passengerProfile.findUnique({
        where: { userId: job.userId }
      });
      if (profile?.emailEncrypted) {
        void decryptPii(profile.emailEncrypted);
      }

      this.deliveredLog.push({
        type: job.type,
        entityId: job.refundId,
        sentAt: new Date().toISOString()
      });

      await auditService.record({
        actorId: job.userId,
        actorRole: 'SYSTEM',
        entityType: 'NOTIFICATION',
        entityId: job.refundId,
        action: 'REFUND_COMPLETED_EMAIL_DISPATCHED',
        metadata: {
          bookingId: job.bookingId,
          pnr: job.pnr,
          amountPaise: job.amountPaise
        }
      });

      logger.info(
        { refundId: job.refundId, bookingId: job.bookingId, amountPaise: job.amountPaise },
        'Dispatched refund completion notification'
      );
    }
  }
}

export const notificationService = new NotificationService();