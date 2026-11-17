import { prisma, type Prisma } from '@skybook/database';

export class PaymentRepository {
  async findBookingForPayment(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        paymentIntents: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
  }

  async createPaymentIntent(
    data: {
      bookingId: string;
      userId: string;
      razorpayOrderId: string;
      amountPaise: number;
      currency: string;
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma;
    return client.paymentIntent.create({
      data: {
        ...data,
        status: 'PENDING'
      }
    });
  }

  async findPaymentIntentByOrderId(razorpayOrderId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma;
    return client.paymentIntent.findUnique({
      where: { razorpayOrderId }
    });
  }

  async findWebhookEventByEventId(eventId: string) {
    return prisma.webhookEvent.findUnique({
      where: { eventId }
    });
  }

  async findWebhookEventById(id: string) {
    return prisma.webhookEvent.findUnique({
      where: { id }
    });
  }

  async createWebhookEvent(data: {
    eventId: string;
    eventType: string;
    payload: Prisma.InputJsonValue;
  }) {
    return prisma.webhookEvent.create({
      data: {
        provider: 'RAZORPAY',
        eventId: data.eventId,
        eventType: data.eventType,
        payload: data.payload,
        status: 'RECEIVED'
      }
    });
  }
}