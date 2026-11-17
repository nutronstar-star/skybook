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

export async function buildApp(): Promise<FastifyInstance> {
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
    origin: [env.PASSENGER_ORIGIN, env.ADMIN_ORIGIN],
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

  // Module 1: Identity & Auth Routes
  await app.register(identityRoutes, { prefix: '/v1' });

  // Module 8: Audit Routes
  await app.register(auditRoutes, { prefix: '/v1/admin' });

  return app;
}