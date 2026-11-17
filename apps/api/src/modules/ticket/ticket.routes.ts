import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../../shared/middleware/auth.middleware.js';
import { rateLimit } from '../../shared/middleware/rate-limit.middleware.js';
import { ticketController } from './ticket.controller.js';

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/tickets/public-key',
    {
      preHandler: [rateLimit('read')],
      schema: {
        tags: ['Tickets · Verification'],
        summary: 'Fetch Ed25519 SPKI public key for offline QR verification (FR-PAX-031)'
      }
    },
    (req, reply) => ticketController.getPublicKey(req, reply)
  );

  app.post(
    '/tickets/verify',
    {
      preHandler: [rateLimit('read')],
      schema: {
        tags: ['Tickets · Verification'],
        summary: 'Verify Ed25519 QR token signature & active booking status (FR-PAX-031, 035)'
      }
    },
    (req, reply) => ticketController.verifyTicket(req, reply)
  );

  app.get(
    '/tickets/:bookingId',
    {
      preHandler: [requireAuth, rateLimit('read')],
      schema: {
        tags: ['Passenger · Tickets'],
        summary: 'Retrieve signed QR e-tickets for an owned booking (FR-PAX-033, 034)'
      }
    },
    (req, reply) => ticketController.getBookingTickets(req, reply)
  );
}