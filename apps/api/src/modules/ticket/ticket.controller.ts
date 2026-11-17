import type { FastifyReply, FastifyRequest } from 'fastify';
import { ticketService } from './ticket.service.js';
import { TicketBookingIdParamSchema, VerifyTicketRequestSchema } from './ticket.types.js';

export class TicketController {
  async getBookingTickets(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { bookingId } = TicketBookingIdParamSchema.parse(request.params);
    const result = await ticketService.getBookingTickets(bookingId, request.authUser!);
    return reply.status(200).send(result);
  }

  async getPublicKey(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    return reply.status(200).send({
      algorithm: 'Ed25519',
      format: 'spki-der-base64',
      publicKey: ticketService.getPublicKeyBase64()
    });
  }

  async verifyTicket(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = VerifyTicketRequestSchema.parse(request.body);
    const result = await ticketService.verifyTicket(body.qrToken);
    return reply.status(200).send(result);
  }
}

export const ticketController = new TicketController();