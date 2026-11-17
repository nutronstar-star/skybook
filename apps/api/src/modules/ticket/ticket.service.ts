import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject
} from 'node:crypto';
import { prisma, decryptPii, type Prisma } from '@skybook/database';
import {
  canonicalizeJson,
  ErrorCode,
  verifyTicketQrToken,
  type TicketQrPayload
} from '@skybook/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  assertTenantOwnership,
  type AuthenticatedActor
} from '../../shared/middleware/auth.middleware.js';
import { auditService } from '../audit/index.js';

interface Ed25519KeyRing {
  privateKey: KeyObject;
  publicKeySpkiBase64: string;
}

function loadOrGenerateEd25519Keys(): Ed25519KeyRing {
  if (env.TICKET_ED25519_PRIVATE_KEY_B64.length >= 40 && env.TICKET_ED25519_PUBLIC_KEY_B64.length >= 40) {
    const privDer = Buffer.from(env.TICKET_ED25519_PRIVATE_KEY_B64, 'base64');
    const privateKey = createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
    return {
      privateKey,
      publicKeySpkiBase64: env.TICKET_ED25519_PUBLIC_KEY_B64
    };
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey,
    publicKeySpkiBase64: Buffer.from(spkiDer).toString('base64')
  };
}

export class TicketService {
  private readonly keyRing: Ed25519KeyRing = loadOrGenerateEd25519Keys();

  public getPublicKeyBase64(): string {
    return this.keyRing.publicKeySpkiBase64;
  }

  private signQrPayload(payload: TicketQrPayload): string {
    const canonical = canonicalizeJson(payload);
    const payloadB64 = Buffer.from(canonical, 'utf8').toString('base64url');
    const signature = sign(null, Buffer.from(canonical, 'utf8'), this.keyRing.privateKey);
    const sigB64 = signature.toString('base64url');
    return `v1:${payloadB64}:${sigB64}`;
  }

  /**
   * Issues Ed25519-signed QR e-tickets for every active passenger in a confirmed booking (FR-PAX-031, P4).
   */
  async issueTicketsForBooking(bookingId: string, tx: Prisma.TransactionClient) {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        passengers: {
          where: { status: 'ACTIVE' },
          include: { seat: true }
        },
        tickets: true
      }
    });

    if (!booking) {
      throw AppError.notFound('Booking not found for ticket issuance');
    }

    // Idempotent if tickets were already issued
    if (booking.tickets.length > 0) {
      return booking.tickets;
    }

    const issuedTickets = [];
    for (const pax of booking.passengers) {
      const ticketId = randomUUID();
      const issuedAt = new Date();
      const nonce = randomBytes(16).toString('hex');
      const passengerName = decryptPii(pax.fullNameEncrypted);

      const qrPayload: TicketQrPayload = {
        version: 'v1',
        ticketId,
        bookingId: booking.id,
        flightId: booking.flightId,
        seatId: pax.seatId,
        seatLabel: pax.seat.seatNumber,
        passengerName,
        issuedAt: issuedAt.toISOString(),
        nonce
      };

      const qrToken = this.signQrPayload(qrPayload);

      const created = await tx.ticket.create({
        data: {
          id: ticketId,
          bookingId: booking.id,
          bookingPassengerId: pax.id,
          flightId: booking.flightId,
          seatId: pax.seatId,
          seatLabel: pax.seat.seatNumber,
          qrToken,
          nonce,
          status: 'ACTIVE',
          issuedAt
        }
      });

      issuedTickets.push(created);
    }

    await auditService.record(
      {
        actorId: booking.userId,
        actorRole: 'SYSTEM',
        entityType: 'TICKET',
        entityId: booking.id,
        action: 'ED25519_TICKETS_ISSUED',
        metadata: {
          pnr: booking.pnr,
          ticketIds: issuedTickets.map((t) => t.id)
        }
      },
      tx
    );

    return issuedTickets;
  }

  /**
   * Invalidates all tickets for a booking upon cancellation (FR-PAX-035).
   */
  async invalidateTicketsForBooking(bookingId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.ticket.updateMany({
      where: { bookingId, status: 'ACTIVE' },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date()
      }
    });
  }

  /**
   * Owner-scoped retrieval of signed QR tickets + PNR (FR-PAX-033, FR-PAX-034).
   */
  async getBookingTickets(bookingId: string, actor: AuthenticatedActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        flight: {
          include: {
            originAirport: { include: { city: true } },
            destinationAirport: { include: { city: true } }
          }
        },
        tickets: {
          include: {
            bookingPassenger: true
          },
          orderBy: { seatLabel: 'asc' }
        }
      }
    });

    if (!booking) {
      throw AppError.notFound('Booking not found');
    }

    // FR-PAX-033 & FR-XC-002: Cross-tenant access returns 404
    assertTenantOwnership(booking.userId, actor);

    if (booking.status === 'PENDING' && booking.tickets.length === 0) {
      throw AppError.badRequest(
        ErrorCode.INVALID_TRANSITION,
        'Tickets are issued once payment is confirmed'
      );
    }

    return {
      bookingId: booking.id,
      pnr: booking.pnr,
      bookingStatus: booking.status,
      cabinClass: booking.cabinClass,
      flight: {
        id: booking.flight.id,
        flightNumber: booking.flight.flightNumber,
        airlineName: booking.flight.airlineName,
        origin: {
          iataCode: booking.flight.originAirport.iataCode,
          cityName: booking.flight.originAirport.city.name
        },
        destination: {
          iataCode: booking.flight.destinationAirport.iataCode,
          cityName: booking.flight.destinationAirport.city.name
        },
        departureTime: booking.flight.departureTime.toISOString(),
        arrivalTime: booking.flight.arrivalTime.toISOString()
      },
      tickets: booking.tickets.map((t) => ({
        ticketId: t.id,
        seatLabel: t.seatLabel,
        passengerName: decryptPii(t.bookingPassenger.fullNameEncrypted),
        status: t.status,
        issuedAt: t.issuedAt.toISOString(),
        cancelledAt: t.cancelledAt?.toISOString() ?? null,
        qrToken: t.qrToken
      }))
    };
  }

  /**
   * Verifies Ed25519 signature AND live database status (FR-PAX-031, FR-PAX-035, P4).
   */
  async verifyTicket(qrToken: string) {
    const cryptoResult = verifyTicketQrToken(qrToken, this.keyRing.publicKeySpkiBase64);
    if (!cryptoResult.valid || !cryptoResult.payload) {
      return {
        valid: false,
        reason: cryptoResult.reason ?? 'INVALID_SIGNATURE'
      };
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: cryptoResult.payload.ticketId },
      include: {
        booking: { select: { pnr: true, status: true } }
      }
    });

    if (!ticket) {
      return {
        valid: false,
        reason: 'TICKET_NOT_FOUND'
      };
    }

    if (ticket.status !== 'ACTIVE' || ticket.booking.status === 'CANCELLED') {
      return {
        valid: false,
        reason: 'TICKET_CANCELLED',
        ticketId: ticket.id,
        pnr: ticket.booking.pnr
      };
    }

    return {
      valid: true,
      ticketId: ticket.id,
      pnr: ticket.booking.pnr,
      payload: cryptoResult.payload
    };
  }
}

export const ticketService = new TicketService();