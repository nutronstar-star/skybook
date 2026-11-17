import type { FastifyReply, FastifyRequest } from 'fastify';
import { CreatePaymentOrderSchema } from '@skybook/shared';
import { paymentService } from './payment.service.js';
import { PaymentBookingIdParamSchema } from './payment.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export class PaymentController {
  async createOrder(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = CreatePaymentOrderSchema.parse(request.body);
    const result = await paymentService.initiatePaymentOrder(body.bookingId, request.authUser!, {
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(201).send(result);
  }

  async getStatus(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { bookingId } = PaymentBookingIdParamSchema.parse(request.params);
    const status = await paymentService.getPaymentStatus(bookingId, request.authUser!);
    return reply.status(200).send(status);
  }

  async handleWebhook(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const rawBody =
      request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}), 'utf8');

    const sigRaw = request.headers['x-razorpay-signature'];
    const signatureHeader = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;

    const evtRaw = request.headers['x-razorpay-event-id'];
    const eventIdHeader = Array.isArray(evtRaw) ? evtRaw[0] : evtRaw;

    const result = await paymentService.ingestRazorpayWebhook({
      rawBody,
      signatureHeader,
      eventIdHeader
    });

    return reply.status(200).send(result);
  }
}

export const paymentController = new PaymentController();