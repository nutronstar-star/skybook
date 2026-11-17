export type EmailNotificationJobData =
  | {
      type: 'TICKET_ISSUED';
      bookingId: string;
      userId: string;
      pnr: string;
      ticketCount: number;
    }
  | {
      type: 'REFUND_COMPLETED';
      refundId: string;
      bookingId: string;
      userId: string;
      pnr: string;
      amountPaise: number;
    }
  | {
      type: 'ADMIN_PASSWORD_RESET';
      adminUserId: string;
      resetId: string;
    };

export type EnqueueEmailFn = (job: EmailNotificationJobData) => Promise<void>;