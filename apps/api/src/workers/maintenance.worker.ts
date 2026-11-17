import { prisma } from '@skybook/database';
import { logger } from '../shared/logger/pii-scrubber.js';
import { refundService } from '../modules/refund/index.js';

/**
 * Background maintenance sweeper:
 * - Every 1 min: expires orphaned Postgres seat_locks (FR-PAX-013 AC-05)
 * - Every 15 min: purges expired otp_challenges (> 1h old) & retries FAILED/INITIATED refunds (EI-03)
 */
export class MaintenanceWorker {
  private lockSweepTimer: NodeJS.Timeout | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;

  public start(): void {
    if (this.lockSweepTimer) return;

    this.lockSweepTimer = setInterval(() => {
      void this.sweepExpiredSeatLocks();
    }, 60_000);
    this.lockSweepTimer.unref();

    this.periodicTimer = setInterval(() => {
      void this.runFifteenMinuteTasks();
    }, 15 * 60_000);
    this.periodicTimer.unref();
  }

  public async sweepExpiredSeatLocks(): Promise<number> {
    try {
      const now = new Date();
      const res = await prisma.seatLock.updateMany({
        where: {
          status: 'LOCKED',
          expiresAt: { lte: now }
        },
        data: {
          status: 'EXPIRED',
          releasedAt: now
        }
      });
      return res.count;
    } catch (err) {
      logger.error({ err: String(err) }, 'Seat lock sweep failed');
      return 0;
    }
  }

  public async runFifteenMinuteTasks(): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - 3_600_000);
      await prisma.otpChallenge.deleteMany({
        where: { expiresAt: { lt: oneHourAgo } }
      });

      const pendingRefunds = await prisma.refund.findMany({
        where: {
          status: { in: ['FAILED', 'INITIATED'] },
          retryCount: { lt: 5 },
          updatedAt: { lt: new Date(Date.now() - 15 * 60_000) }
        },
        take: 25
      });

      for (const ref of pendingRefunds) {
        await refundService.retryRefund(ref.id, {
          reason: 'Scheduled 15-minute refund retry worker (EI-03)'
        });
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'Periodic maintenance task failed');
    }
  }

  public close(): void {
    if (this.lockSweepTimer) {
      clearInterval(this.lockSweepTimer);
      this.lockSweepTimer = null;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }
}