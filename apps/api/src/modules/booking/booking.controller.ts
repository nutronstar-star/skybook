import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminReasonSchema,
  CreateBookingSchema,
  SeatLockRequestSchema
} from '@skybook/shared';
import { bookingService } from './booking.service.js';
import {
  AdminBookingListQuerySchema,
  BookingIdParamSchema,
  LockIdParamSchema
} from './booking.types.js';

export class BookingController {
  async lockSeats(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = SeatLockRequestSchema.parse(request.body);
    const result = await bookingService.lockSeats(body, {
      userId: request.authUser!.userId,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(201).send(result);
  }

  async releaseSeatLock(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { lockId } = LockIdParamSchema.parse(request.params);
    const result = await bookingService.releaseSeatLock(lockId, {
      userId: request.authUser!.userId,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(200).send(result);
  }

  async getActiveLocks(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const locks = await bookingService.getActiveLocks(request.authUser!.userId);
    return reply.status(200).send({ data: locks });
  }

  async createBooking(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = CreateBookingSchema.parse(request.body);
    const booking = await bookingService.createBookingFromLock(body, {
      userId: request.authUser!.userId,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(201).send(booking);
  }

  async listMyBookings(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const bookings = await bookingService.listPassengerBookings(request.authUser!.userId);
    return reply.status(200).send({ data: bookings });
  }

  async getBookingDetail(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = BookingIdParamSchema.parse(request.params);
    const booking = await bookingService.getPassengerBookingDetail(id, request.authUser!);
    return reply.status(200).send(booking);
  }

  async updateBookingRejected(request: FastifyRequest, _reply: FastifyReply): Promise<never> {
    const { id } = BookingIdParamSchema.parse(request.params);
    return bookingService.rejectBookingMutation(id, request.authUser!);
  }

  // Admin endpoints (FR-ADM-011..015)
  async adminListBookings(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = AdminBookingListQuerySchema.parse(request.query);
    const result = await bookingService.listAdminBookingsMasked(query);
    return reply.status(200).send(result);
  }

  async adminUnmaskBooking(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = BookingIdParamSchema.parse(request.params);
    const { reason } = AdminReasonSchema.parse(request.body);
    const unmasked = await bookingService.unmaskBookingPiiForAdmin(id, reason, {
      adminUserId: request.authUser!.userId,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(200).send(unmasked);
  }

  async adminExportBookingsCsv(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = AdminBookingListQuerySchema.parse(request.query);
    const csv = await bookingService.exportAdminBookingsCsv(query);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="skybook-bookings.csv"')
      .status(200)
      .send(csv);
  }

  async adminRevenueDashboard(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const dashboard = await bookingService.getRevenueDashboard();
    return reply.status(200).send(dashboard);
  }
}

export const bookingController = new BookingController();