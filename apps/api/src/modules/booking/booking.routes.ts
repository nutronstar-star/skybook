import type { FastifyInstance } from 'fastify';
import {
  requireAdmin,
  requireAuth,
  requirePassenger
} from '../../shared/middleware/auth.middleware.js';
import { requireAdminReason } from '../../shared/middleware/admin-reason.middleware.js';
import { rateLimit } from '../../shared/middleware/rate-limit.middleware.js';
import { bookingController } from './booking.controller.js';

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  // Seat Locking (FR-PAX-013..018)
  app.post(
    '/seats/lock',
    {
      preHandler: [requirePassenger, rateLimit('write')],
      schema: { tags: ['Passenger · Seats'], summary: 'Lock 1-6 seats for 300s (FR-PAX-013)' }
    },
    (req, reply) => bookingController.lockSeats(req, reply)
  );

  app.delete(
    '/seats/lock/:lockId',
    {
      preHandler: [requirePassenger, rateLimit('write')],
      schema: { tags: ['Passenger · Seats'], summary: 'Release seat lock before expiry (FR-PAX-015)' }
    },
    (req, reply) => bookingController.releaseSeatLock(req, reply)
  );

  app.get(
    '/seats/lock/active',
    {
      preHandler: [requirePassenger, rateLimit('read')],
      schema: { tags: ['Passenger · Seats'], summary: 'Get active seat locks to resume booking (FR-PAX-018)' }
    },
    (req, reply) => bookingController.getActiveLocks(req, reply)
  );

  // Passenger Bookings (FR-PAX-019..024, FR-PAX-042)
  app.post(
    '/bookings',
    {
      preHandler: [requirePassenger, rateLimit('write')],
      schema: { tags: ['Passenger · Bookings'], summary: 'Create PENDING booking from active lock (FR-PAX-019)' }
    },
    (req, reply) => bookingController.createBooking(req, reply)
  );

  app.get(
    '/bookings',
    {
      preHandler: [requirePassenger, rateLimit('read')],
      schema: { tags: ['Passenger · Bookings'], summary: 'List authenticated passenger bookings (FR-PAX-040)' }
    },
    (req, reply) => bookingController.listMyBookings(req, reply)
  );

  app.get(
    '/bookings/:id',
    {
      preHandler: [requireAuth, rateLimit('read')],
      schema: { tags: ['Passenger · Bookings'], summary: 'Get booking detail (row-scoped 404 isolation)' }
    },
    (req, reply) => bookingController.getBookingDetail(req, reply)
  );

  app.patch(
    '/bookings/:id',
    {
      preHandler: [requirePassenger, rateLimit('write')],
      schema: { tags: ['Passenger · Bookings'], summary: 'Reject edits on immutable booking (FR-PAX-024)' }
    },
    (req, reply) => bookingController.updateBookingRejected(req, reply)
  );

  // Admin Booking Oversight & Revenue (FR-ADM-011..015)
  app.get(
    '/admin/bookings',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: { tags: ['Admin · Bookings'], summary: 'List all bookings with PII masked (FR-ADM-011)' }
    },
    (req, reply) => bookingController.adminListBookings(req, reply)
  );

  app.post(
    '/admin/bookings/:id/unmask',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Bookings'], summary: 'Unmask passenger PII with mandatory reason (FR-ADM-012)' }
    },
    (req, reply) => bookingController.adminUnmaskBooking(req, reply)
  );

  app.get(
    '/admin/bookings/export.csv',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: { tags: ['Admin · Bookings'], summary: 'Export masked bookings CSV (FR-ADM-014)' }
    },
    (req, reply) => bookingController.adminExportBookingsCsv(req, reply)
  );

  app.get(
    '/admin/dashboard/revenue',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: { tags: ['Admin · Dashboard'], summary: 'Daily, per-flight & per-class revenue metrics (FR-ADM-015)' }
    },
    (req, reply) => bookingController.adminRevenueDashboard(req, reply)
  );
}