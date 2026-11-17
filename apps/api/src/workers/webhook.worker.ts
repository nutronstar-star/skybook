import { Queue, Worker, type Job } from 'bullmq';
import { redis } from '../shared/redis/client.js';
import { logger } from '../shared/logger/pii-scrubber.js';
import { paymentService } from '../modules/payment/index.js';

export const WEBHOOK_QUEUE_NAME = 'skybook-webhooks';

export interface WebhookJobData {
  webhookEventId: string;
}

export class WebhookWorkerManager {
  private readonly queueConnection = redis.duplicate({ maxRetriesPerRequest: null });
  private readonly workerConnection = redis.duplicate({ maxRetriesPerRequest: null });
  private readonly queue: Queue<WebhookJobData>;
  private worker: Worker<WebhookJobData> | null = null;

  constructor() {
    this.queue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 500
        },
        removeOnComplete: 500,
        removeOnFail: 1000
      }
    });

    paymentService.setWebhookEnqueuer(async (webhookEventId: string) => {
      await this.queue.add(
        'process-razorpay-webhook',
        { webhookEventId },
        { jobId: `wh_${webhookEventId}` }
      );
    });
  }

  public start(): void {
    if (this.worker) return;

    this.worker = new Worker<WebhookJobData>(
      WEBHOOK_QUEUE_NAME,
      async (job: Job<WebhookJobData>) => {
        await paymentService.processWebhookEventById(job.data.webhookEventId);
      },
      {
        connection: this.workerConnection,
        concurrency: 5
      }
    );

    this.worker.on('failed', (job, err) => {
      logger.error(
        { jobId: job?.id, err: err.message },
        'BullMQ webhook-worker job failed'
      );
    });
  }

  public async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
    try {
      await this.queueConnection.quit();
    } catch {
      this.queueConnection.disconnect();
    }
    try {
      await this.workerConnection.quit();
    } catch {
      this.workerConnection.disconnect();
    }
  }
}