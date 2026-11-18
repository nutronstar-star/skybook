import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { prisma } from '@skybook/database';
import { env } from './config/env.js';
import { logger } from './shared/logger/pii-scrubber.js';
import { globalErrorHandler } from './shared/errors/error-handler.js';
import { persistIdempotencyResponse } from './shared/middleware/idempotency.middleware.js';
import { redis, isRedisReady } from './shared/redis/client.js';
import { auditRoutes } from './modules/audit/index.js';
import { identityRoutes } from './modules/identity/index.js';
import { flightRoutes, flightService } from './modules/flight/index.js';
import { bookingRoutes } from './modules/booking/index.js';
import { paymentRoutes, paymentService } from './modules/payment/index.js';
import { ticketRoutes, ticketService } from './modules/ticket/index.js';
import { refundRoutes, refundService } from './modules/refund/index.js';
import { notificationService } from './modules/notification/index.js';
import { SeatWebSocketGateway } from './ws/index.js';
import {
  EmailWorkerManager,
  MaintenanceWorker,
  WebhookWorkerManager
} from './workers/index.js';

export interface BuildAppOptions {
  enableWebSockets?: boolean;
  wsHandshakeTimeoutMs?: number;
  enableWorkers?: boolean;
}

let domainHooksWired = false;

function ensureDomainHooksWired(): void {
  if (domainHooksWired) return;
  domainHooksWired = true;

  // 1. When payment settles via webhook -> issue Ed25519 QR tickets + enqueue ticket email
  paymentService.onPaymentSucceeded(async (ctx, tx) => {
    const tickets = await ticketService.issueTicketsForBooking(ctx.bookingId, tx);
    const booking = await tx.booking.findUnique({
      where: { id: ctx.bookingId },
      select: { pnr: true }
    });
    if (booking) {
      await notificationService.enqueueTicketIssued({
        bookingId: ctx.bookingId,
        userId: ctx.userId,
        pnr: booking.pnr,
        ticketCount: tickets.length
      });
    }
  });

  // 2. When Razorpay refund webhook settles -> update Refund status & notify passenger
  paymentService.onRefundProcessed(async (ctx, tx) => {
    await refundService.handleGatewayRefundWebhook(ctx.razorpayRefundId, ctx.status, tx);
  });

  // 3. When Admin cancels a flight -> automatically initiate 100% refunds for all bookings
  flightService.onFlightCancelled(async (event) => {
    await refundService.handleFlightCancelledCascade(event);
  });
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  ensureDomainHooksWired();

  const app = Fastify({
    logger: logger as unknown as FastifyBaseLogger,
    genReqId: (req) => {
      const headerId = req.headers['x-request-id'];
      return typeof headerId === 'string' && headerId.length > 0 ? headerId : randomUUID();
    },
    trustProxy: true
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:']
      }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || env.CORS_ORIGIN === '*') return cb(null, true);
      const allowed = env.CORS_ORIGIN.split(',').map((s) => s.trim().replace(/\/$/, ''));
      if (allowed.includes(origin) || origin.endsWith('.vercel.app') || origin.endsWith('.netlify.app')) {
        return cb(null, true);
      }
      return cb(null, false);
    }, env.ADMIN_ORIGIN],
    credentials: true
  });

  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    parseOptions: {
      httpOnly: true,
      sameSite: 'strict',
      secure: env.NODE_ENV === 'production',
      path: '/'
    }
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'SkyBook Unified Flight Reservation & Operations API',
        version: '1.0.0',
        description: 'Modular monolith backend serving Passenger Portal & Admin Console'
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('X-Request-Id', request.id);
    return persistIdempotencyResponse(request, reply, payload);
  });

  app.setErrorHandler(globalErrorHandler);

  app.get(
    '/v1/health',
    {
      schema: {
        tags: ['System'],
        summary: 'System health check (FR-XC-008)'
      }
    },
    async (_request, reply) => {
      const started = performance.now();
      let dbOk = false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbOk = true;
      } catch {
        dbOk = false;
      }

      let redisOk = false;
      try {
        if (isRedisReady()) {
          const pong = await redis.ping();
          redisOk = pong === 'PONG';
        }
      } catch {
        redisOk = false;
      }

      const healthy = dbOk && redisOk;
      const latencyMs = Math.round((performance.now() - started) * 100) / 100;

      return reply.status(healthy ? 200 : 503).send({
        status: healthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        latencyMs,
        services: {
          postgres: dbOk ? 'up' : 'down',
          redis: redisOk ? 'up' : 'down'
        }
      });
    }
  );

  // Register all 8 Domain Modules
  await app.register(identityRoutes, { prefix: '/v1' });
  await app.register(flightRoutes, { prefix: '/v1' });
  await app.register(bookingRoutes, { prefix: '/v1' });
  await app.register(paymentRoutes, { prefix: '/v1' });
  await app.register(ticketRoutes, { prefix: '/v1' });
  await app.register(refundRoutes, { prefix: '/v1' });
  await app.register(auditRoutes, { prefix: '/v1/admin' });

  // BullMQ Workers + Periodic Maintenance Sweeper
  if (options.enableWorkers !== false) {
    const webhookWorkers = new WebhookWorkerManager();
    const emailWorkers = new EmailWorkerManager();
    const maintenanceWorker = new MaintenanceWorker();

    webhookWorkers.start();
    emailWorkers.start();
    maintenanceWorker.start();

    app.addHook('onClose', async () => {
      maintenanceWorker.close();
      await emailWorkers.close();
      await webhookWorkers.close();
    });
  }

  // RFC 6455 WebSocket Gateway for Real-Time Seat Updates (FR-PAX-017, EI-07)
  if (options.enableWebSockets !== false) {
    const wsGateway = new SeatWebSocketGateway(options.wsHandshakeTimeoutMs);
    wsGateway.attach(app.server);
    app.addHook('onClose', async () => {
      await wsGateway.close();
    });
  }

  return app;
}