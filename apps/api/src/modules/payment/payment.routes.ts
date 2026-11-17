import type { FastifyInstance } from 'fastify';
import { requirePassenger } from '../../shared/middleware/auth.middleware.js';
import { rateLimit } from '../../shared/middleware/rate-limit.middleware.js';
import { requireIdempotencyKey } from '../../shared/middleware/idempotency.middleware.js';
import { paymentController } from './payment.controller.js';

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  // Encapsulated raw-body parser so X-Razorpay-Signature HMAC-SHA256 hashes exact wire bytes
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    req.rawBody = buf;
    if (buf.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(buf.toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post(
    '/payments/orders',
    {
      preHandler: [requirePassenger, rateLimit('write'), requireIdempotencyKey],
      schema: {
        tags: ['Passenger · Payments'],
        summary: 'Create idempotent Razorpay payment order (FR-PAX-025, FR-PAX-026)'
      }
    },
    (req, reply) => paymentController.createOrder(req, reply)
  );

  app.get(
    '/payments/:bookingId/status',
    {
      preHandler: [requirePassenger, rateLimit('read')],
      schema: {
        tags: ['Passenger · Payments'],
        summary: 'Get payment status for a booking (FR-PAX-029)'
      }
    },
    (req, reply) => paymentController.getStatus(req, reply)
  );

  app.post(
    '/payments/webhook',
    {
      schema: {
        tags: ['Webhooks · Razorpay'],
        summary: 'HMAC-verified idempotent Razorpay webhook endpoint (FR-PAX-027, FR-PAX-030)'
      }
    },
    (req, reply) => paymentController.handleWebhook(req, reply)
  );
}