import { prisma } from '@skybook/database';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { redis } from './shared/redis/client.js';
import { logger } from './shared/logger/pii-scrubber.js';

async function start(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down SkyBook API gracefully...');
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`SkyBook API listening on http://${env.HOST}:${env.PORT} (OpenAPI: /docs)`);
}

start().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});