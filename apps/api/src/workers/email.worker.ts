import { Queue, Worker, type Job } from 'bullmq';
import { redis } from '../shared/redis/client.js';
import { logger } from '../shared/logger/pii-scrubber.js';
import {
  notificationService,
  type EmailNotificationJobData
} from '../modules/notification/index.js';

export const EMAIL_QUEUE_NAME = 'skybook-emails';

export class EmailWorkerManager {
  private readonly queueConnection = redis.duplicate({ maxRetriesPerRequest: null });
  private readonly workerConnection = redis.duplicate({ maxRetriesPerRequest: null });
  private readonly queue: Queue<EmailNotificationJobData>;
  private worker: Worker<EmailNotificationJobData> | null = null;

  constructor() {
    this.queue = new Queue<EmailNotificationJobData>(EMAIL_QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: 3, // EI-05: retry 3x with exponential backoff
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: 500,
        removeOnFail: 1000
      }
    });

    notificationService.setEmailEnqueuer(async (job) => {
      await this.queue.add(job.type, job);
    });
  }

  public start(): void {
    if (this.worker) return;

    this.worker = new Worker<EmailNotificationJobData>(
      EMAIL_QUEUE_NAME,
      async (job: Job<EmailNotificationJobData>) => {
        await notificationService.processEmailJob(job.data);
      },
      {
        connection: this.workerConnection,
        concurrency: 5
      }
    );

    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err: err.message }, 'BullMQ email-worker job failed');
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