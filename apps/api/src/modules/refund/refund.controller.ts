import type { FastifyReply, FastifyRequest } from 'fastify';
import { AdminReasonSchema } from '@skybook/shared';
import { refundService } from './refund.service.js';
import {
  AdminRefundListQuerySchema,
  PassengerCancelBookingSchema,
  RefundBookingIdParamSchema,
  RefundIdParamSchema
} from './refund.types.js';

export class RefundController {
  async previewRefund(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = RefundBookingIdParamSchema.parse(request.params);
    const preview = await refundService.previewRefund(id, request.authUser!);
    return reply.status(200).send(preview);
  }

  async cancelBooking(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = RefundBookingIdParamSchema.parse(request.params);
    const body = PassengerCancelBookingSchema.parse(request.body ?? {});
    const result = await refundService.cancelBookingByPassenger(id, request.authUser!, {
      reason: body.reason,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(200).send(result);
  }

  async adminListRefunds(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = AdminRefundListQuerySchema.parse(request.query);
    const result = await refundService.listAdminRefunds(query);
    return reply.status(200).send(result);
  }

  async adminApproveRefund(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = RefundIdParamSchema.parse(request.params);
    const { reason } = AdminReasonSchema.parse(request.body);
    const updated = await refundService.approveRefundByAdmin(id, reason, {
      adminUserId: request.authUser!.userId,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(200).send(updated);
  }

  async adminRejectRefund(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = RefundIdParamSchema.parse(request.params);
    const { reason } = AdminReasonSchema.parse(request.body);
    const updated = await refundService.rejectRefundByAdmin(id, reason, {
      adminUserId: request.authUser!.userId,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(200).send(updated);
  }

  async adminRetryRefund(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = RefundIdParamSchema.parse(request.params);
    const { reason } = AdminReasonSchema.parse(request.body);
    const updated = await refundService.retryRefund(id, {
      adminUserId: request.authUser!.userId,
      reason,
      ipAddress: request.ip,
      requestId: request.id
    });
    return reply.status(200).send(updated);
  }
}

export const refundController = new RefundController();