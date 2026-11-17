import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../shared/middleware/auth.middleware.js';
import { requireAdminReason } from '../../shared/middleware/admin-reason.middleware.js';
import { rateLimit } from '../../shared/middleware/rate-limit.middleware.js';
import { flightController } from './flight.controller.js';

export async function flightRoutes(app: FastifyInstance): Promise<void> {
  // Public / Passenger Discovery (FR-PAX-006..012)
  app.get(
    '/cities/autocomplete',
    {
      preHandler: [rateLimit('read')],
      schema: { tags: ['Flights · Search'], summary: 'City and airport autocomplete (FR-PAX-007)' }
    },
    (req, reply) => flightController.autocomplete(req, reply)
  );

  app.get(
    '/flights/search',
    {
      preHandler: [rateLimit('read')],
      schema: { tags: ['Flights · Search'], summary: 'Search published flights (FR-PAX-006..011)' }
    },
    (req, reply) => flightController.search(req, reply)
  );

  app.get(
    '/flights/:id',
    {
      preHandler: [rateLimit('read')],
      schema: { tags: ['Flights · Search'], summary: 'Get published flight details' }
    },
    (req, reply) => flightController.getFlight(req, reply)
  );

  app.get(
    '/flights/:id/seat-map',
    {
      preHandler: [rateLimit('read')],
      schema: { tags: ['Flights · Search'], summary: 'Get 2D seat map with live statuses (FR-PAX-012)' }
    },
    (req, reply) => flightController.getSeatMap(req, reply)
  );

  // Admin Flight & Catalog Routes (FR-ADM-004..010)
  app.get(
    '/admin/flights',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: { tags: ['Admin · Flights'], summary: 'List all flights across all statuses (FR-ADM-008)' }
    },
    (req, reply) => flightController.adminListFlights(req, reply)
  );

  app.post(
    '/admin/flights',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Flights'], summary: 'Create DRAFT flight with seat map (FR-ADM-004)' }
    },
    (req, reply) => flightController.adminCreateFlight(req, reply)
  );

  app.patch(
    '/admin/flights/:id',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Flights'], summary: 'Edit flight prior to bookings (FR-ADM-005)' }
    },
    (req, reply) => flightController.adminUpdateFlight(req, reply)
  );

  app.post(
    '/admin/flights/:id/publish',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Flights'], summary: 'Publish DRAFT flight to search (FR-ADM-006)' }
    },
    (req, reply) => flightController.adminPublishFlight(req, reply)
  );

  app.post(
    '/admin/flights/:id/cancel',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Flights'], summary: 'Cancel flight & trigger refunds (FR-ADM-007)' }
    },
    (req, reply) => flightController.adminCancelFlight(req, reply)
  );

  app.get(
    '/admin/cities',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: { tags: ['Admin · Catalog'], summary: 'List cities and airports (FR-ADM-009)' }
    },
    (req, reply) => flightController.adminListCities(req, reply)
  );

  app.post(
    '/admin/cities',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Catalog'], summary: 'Create city (FR-ADM-009)' }
    },
    (req, reply) => flightController.adminCreateCity(req, reply)
  );

  app.patch(
    '/admin/cities/:id',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Catalog'], summary: 'Edit or deactivate city (FR-ADM-009)' }
    },
    (req, reply) => flightController.adminUpdateCity(req, reply)
  );

  app.post(
    '/admin/airports',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Catalog'], summary: 'Create airport (FR-ADM-009)' }
    },
    (req, reply) => flightController.adminCreateAirport(req, reply)
  );

  app.patch(
    '/admin/airports/:id',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Catalog'], summary: 'Edit or deactivate airport (FR-ADM-009)' }
    },
    (req, reply) => flightController.adminUpdateAirport(req, reply)
  );

  app.get(
    '/admin/aircraft-types',
    {
      preHandler: [requireAdmin, rateLimit('read')],
      schema: { tags: ['Admin · Catalog'], summary: 'List aircraft types (FR-ADM-010)' }
    },
    (req, reply) => flightController.adminListAircraftTypes(req, reply)
  );

  app.post(
    '/admin/aircraft-types',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Catalog'], summary: 'Create aircraft type & seat layout (FR-ADM-010)' }
    },
    (req, reply) => flightController.adminCreateAircraftType(req, reply)
  );

  app.put(
    '/admin/aircraft-types/:id/layouts',
    {
      preHandler: [requireAdmin, rateLimit('write'), requireAdminReason],
      schema: { tags: ['Admin · Catalog'], summary: 'Update aircraft seat layouts for future flights (FR-ADM-010)' }
    },
    (req, reply) => flightController.adminUpdateAircraftLayouts(req, reply)
  );
}