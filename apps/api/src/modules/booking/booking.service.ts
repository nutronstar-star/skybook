import { randomInt, randomUUID } from 'node:crypto';
import {
  prisma,
  encryptPii,
  decryptPii,
  maskPhoneLast4,
  maskEmailDomain,
  maskGovtIdLast4,
  type Prisma
} from '@skybook/database';
import {
  DOMAIN_CONSTANTS,
  ErrorCode,
  type CreateBookingSchema,
  type SeatLockRequestSchema
} from '@skybook/shared';
import type { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
import { redis, isRedisReady } from '../../shared/redis/client.js';
import {
  assertTenantOwnership,
  type AuthenticatedActor
} from '../../shared/middleware/auth.middleware.js';
import { auditService } from '../audit/index.js';
import { flightService } from '../flight/index.js';
import { BookingRepository } from './booking.repository.js';
import {
  SEAT_EVENTS_CHANNEL,
  type AdminBookingListQuery,
  type SeatRealtimeEvent
} from './booking.types.js';

const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePnrCandidate(): string {
  let out = '';
  for (let i = 0; i < DOMAIN_CONSTANTS.PNR_LENGTH; i++) {
    out += PNR_ALPHABET[randomInt(0, PNR_ALPHABET.length)];
  }
  return out;
}

function maskFullName(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.length <= 1 ? '*' : `${part[0]}${'*'.repeat(Math.min(part.length - 1, 4))}`))
    .join(' ');
}

function buildRedisLockKey(flightId: string, seatId: string): string {
  return `lock:flight:${flightId}:seat:${seatId}`;
}

export class BookingService {
  constructor(private readonly repo = new BookingRepository()) {}

  private async publishSeatEvent(event: SeatRealtimeEvent): Promise<void> {
    if (!isRedisReady()) return;
    try {
      await redis.publish(SEAT_EVENTS_CHANNEL, JSON.stringify(event));
    } catch {
      // Non-blocking real-time notification
    }
  }

  /**
   * Dual-layer seat lock: Redis SET NX (300s TTL) + Postgres partial unique constraint (FR-PAX-013, BR-03).
   */
  async lockSeats(
    input: z.infer<typeof SeatLockRequestSchema>,
    meta: { userId: string; ipAddress?: string; requestId?: string }
  ) {
    // NFR-A-05: Booking endpoints return 503 SERVICE_UNAVAILABLE when Redis is down
    if (!isRedisReady()) {
      throw AppError.serviceUnavailable(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Seat locking service is temporarily unavailable'
      );
    }

    const uniqueSeatIds = Array.from(new Set(input.seatIds));
    if (uniqueSeatIds.length !== input.seatIds.length) {
      throw AppError.badRequest(ErrorCode.VALIDATION_ERROR, 'Duplicate seatIds are not allowed');
    }

    const flightData = await this.repo.findPublishedFlightWithSeats(input.flightId, uniqueSeatIds);
    if (!flightData) {
      throw AppError.notFound('Published flight not found');
    }

    if (flightData.seats.length !== uniqueSeatIds.length) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'One or more requested seats do not exist on this flight'
      );
    }

    for (const seat of flightData.seats) {
      if (seat.status !== 'AVAILABLE') {
        throw AppError.conflict(
          ErrorCode.SEAT_LOCKED,
          `Seat ${seat.seatNumber} is no longer available`
        );
      }
    }

    const lockGroupId = randomUUID();
    const ttlSeconds = DOMAIN_CONSTANTS.SEAT_LOCK_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const acquiredRedisKeys: string[] = [];

    // Layer 1: Atomic Redis SET NX per seat
    try {
      for (const seatId of uniqueSeatIds) {
        const redisKey = buildRedisLockKey(input.flightId, seatId);
        const lockVal = JSON.stringify({ userId: meta.userId, lockGroupId });
        const ok = await redis.set(redisKey, lockVal, 'EX', ttlSeconds, 'NX');
        if (ok !== 'OK') {
          if (acquiredRedisKeys.length > 0) {
            await redis.del(...acquiredRedisKeys);
          }
          throw AppError.conflict(
            ErrorCode.SEAT_LOCKED,
            'Selected seat is currently locked by another passenger'
          );
        }
        acquiredRedisKeys.push(redisKey);
      }
    } catch (err) {
      if (acquiredRedisKeys.length > 0) {
        await redis.del(...acquiredRedisKeys);
      }
      throw err;
    }

    // Layer 2: PostgreSQL partial unique constraint uq_seat_locks_active
    try {
      await prisma.$transaction(async (tx) => {
        // Expire any stale rows in PG whose TTL passed before cron sweep
        await tx.seatLock.updateMany({
          where: {
            flightId: input.flightId,
            seatId: { in: uniqueSeatIds },
            status: 'LOCKED',
            expiresAt: { lte: new Date() }
          },
          data: { status: 'EXPIRED', releasedAt: new Date() }
        });

        await tx.seatLock.createMany({
          data: uniqueSeatIds.map((seatId) => ({
            lockGroupId,
            flightId: input.flightId,
            seatId,
            userId: meta.userId,
            status: 'LOCKED',
            expiresAt
          }))
        });

        await auditService.record(
          {
            actorId: meta.userId,
            actorRole: 'PASSENGER',
            entityType: 'SEAT_LOCK',
            entityId: lockGroupId,
            action: 'SEATS_LOCKED',
            metadata: {
              flightId: input.flightId,
              seatIds: uniqueSeatIds,
              expiresAt: expiresAt.toISOString()
            },
            ipAddress: meta.ipAddress,
            requestId: meta.requestId
          },
          tx
        );
      });
    } catch (err) {
      if (acquiredRedisKeys.length > 0) {
        await redis.del(...acquiredRedisKeys);
      }
      const maybePrisma = err as { code?: string };
      if (maybePrisma.code === 'P2002') {
        throw AppError.conflict(
          ErrorCode.SEAT_LOCKED,
          'Selected seat is currently locked by another passenger'
        );
      }
      throw err;
    }

    await this.publishSeatEvent({
      type: 'SEAT_LOCKED',
      flightId: input.flightId,
      seatIds: uniqueSeatIds,
      expiresAt: expiresAt.toISOString(),
      timestamp: new Date().toISOString()
    });

    return {
      lockId: lockGroupId,
      flightId: input.flightId,
      seatIds: uniqueSeatIds,
      ttlSeconds,
      expiresAt: expiresAt.toISOString()
    };
  }

  /**
   * Manual release of a seat lock prior to TTL expiration (FR-PAX-015).
   */
  async releaseSeatLock(
    lockGroupId: string,
    meta: { userId: string; ipAddress?: string; requestId?: string }
  ) {
    const locks = await this.repo.findActiveLocksByGroupId(lockGroupId);
    if (locks.length === 0) {
      throw AppError.notFound('Seat lock not found');
    }

    // FR-XC-002: Cross-tenant access returns 404
    if (locks[0]!.userId !== meta.userId) {
      throw AppError.notFound('Seat lock not found');
    }

    const flightId = locks[0]!.flightId;
    const seatIds = locks.map((l) => l.seatId);

    await prisma.$transaction(async (tx) => {
      await tx.seatLock.updateMany({
        where: { lockGroupId, status: 'LOCKED' },
        data: { status: 'RELEASED', releasedAt: new Date() }
      });

      await auditService.record(
        {
          actorId: meta.userId,
          actorRole: 'PASSENGER',
          entityType: 'SEAT_LOCK',
          entityId: lockGroupId,
          action: 'SEATS_LOCK_RELEASED',
          metadata: { flightId, seatIds },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
    });

    if (isRedisReady()) {
      const keys = seatIds.map((sid) => buildRedisLockKey(flightId, sid));
      await redis.del(...keys);
    }

    await this.publishSeatEvent({
      type: 'SEAT_RELEASED',
      flightId,
      seatIds,
      timestamp: new Date().toISOString()
    });

    return { released: true, lockId: lockGroupId };
  }

  /**
   * Resume abandoned booking if active lock still holds (FR-PAX-018).
   */
  async getActiveLocks(userId: string) {
    const rows = await this.repo.findActiveLockGroupsForUser(userId);
    const grouped = new Map<
      string,
      {
        lockId: string;
        flightId: string;
        flight: (typeof rows)[number]['flight'];
        expiresAt: string;
        seats: Array<(typeof rows)[number]['seat']>;
      }
    >();

    for (const row of rows) {
      const existing = grouped.get(row.lockGroupId);
      if (existing) {
        existing.seats.push(row.seat);
      } else {
        grouped.set(row.lockGroupId, {
          lockId: row.lockGroupId,
          flightId: row.flightId,
          flight: row.flight,
          expiresAt: row.expiresAt.toISOString(),
          seats: [row.seat]
        });
      }
    }

    return Array.from(grouped.values());
  }

  /**
   * Atomic booking creation from an active seat lock (FR-PAX-019..023, BR-01, BR-02).
   */
  async createBookingFromLock(
    input: z.infer<typeof CreateBookingSchema>,
    meta: { userId: string; ipAddress?: string; requestId?: string }
  ) {
    const locks = await this.repo.findActiveLocksByGroupId(input.lockId);
    if (locks.length === 0) {
      throw AppError.badRequest(ErrorCode.LOCK_EXPIRED, 'Seat lock does not exist or has expired');
    }

    // FR-XC-002: Return 404 if lock belongs to a different passenger
    if (locks[0]!.userId !== meta.userId) {
      throw AppError.notFound('Seat lock not found');
    }

    const now = new Date();
    if (locks.some((l) => l.expiresAt <= now)) {
      await prisma.seatLock.updateMany({
        where: { lockGroupId: input.lockId, status: 'LOCKED' },
        data: { status: 'EXPIRED', releasedAt: now }
      });
      throw AppError.badRequest(ErrorCode.LOCK_EXPIRED, 'Seat lock has expired');
    }

    if (input.passengers.length !== locks.length) {
      throw AppError.badRequest(
        ErrorCode.MISSING_PASSENGER,
        `Passenger count (${input.passengers.length}) must match locked seat count (${locks.length})`
      );
    }

    const lockSeatMap = new Map(locks.map((l) => [l.seatId, l.seat]));
    const providedSeatIds = new Set<string>();
    let totalAmountPaise = 0;

    for (const pax of input.passengers) {
      if (providedSeatIds.has(pax.seatId)) {
        throw AppError.badRequest(ErrorCode.VALIDATION_ERROR, 'Duplicate seatId in passenger list');
      }
      providedSeatIds.add(pax.seatId);

      const lockedSeat = lockSeatMap.get(pax.seatId);
      if (!lockedSeat) {
        throw AppError.badRequest(
          ErrorCode.MISSING_PASSENGER,
          `Seat ${pax.seatId} is not part of lock ${input.lockId}`
        );
      }
      if (lockedSeat.cabinClass !== input.cabinClass) {
        throw AppError.badRequest(
          ErrorCode.VALIDATION_ERROR,
          `Seat ${lockedSeat.seatNumber} belongs to ${lockedSeat.cabinClass}, expected ${input.cabinClass}`
        );
      }
      totalAmountPaise += lockedSeat.farePaise;
    }

    const flightId = locks[0]!.flightId;
    const seatIds = locks.map((l) => l.seatId);

    const createdBooking = await prisma.$transaction(async (tx) => {
      // 1. Convert active lock rows atomically (BR-02)
      const converted = await tx.seatLock.updateMany({
        where: {
          lockGroupId: input.lockId,
          userId: meta.userId,
          status: 'LOCKED',
          expiresAt: { gt: new Date() }
        },
        data: {
          status: 'CONVERTED',
          releasedAt: new Date()
        }
      });

      if (converted.count !== locks.length) {
        throw AppError.badRequest(ErrorCode.LOCK_EXPIRED, 'Seat lock expired during checkout');
      }

      // 2. Reserve seats on flight_seats
      await tx.flightSeat.updateMany({
        where: { id: { in: seatIds }, flightId },
        data: { status: 'BOOKED' }
      });

      // 3. Generate unique 6-char PNR
      let pnr = generatePnrCandidate();
      for (let attempt = 0; attempt < 5; attempt++) {
        const clash = await tx.booking.findUnique({ where: { pnr } });
        if (!clash) break;
        pnr = generatePnrCandidate();
      }

      // 4. Insert Booking (status PENDING until Razorpay webhook confirms per FR-PAX-023)
      const booking = await tx.booking.create({
        data: {
          pnr,
          userId: meta.userId,
          flightId,
          cabinClass: input.cabinClass,
          status: 'PENDING',
          totalAmountPaise,
          currency: 'INR',
          passengers: {
            create: input.passengers.map((p) => {
              const seat = lockSeatMap.get(p.seatId)!;
              const cleanId = p.govtIdNumber.replace(/\s+/g, '');
              return {
                flightId,
                seatId: p.seatId,
                status: 'ACTIVE',
                fullNameEncrypted: encryptPii(p.fullName),
                age: p.age,
                gender: p.gender,
                govtIdType: p.govtIdType,
                govtIdNumberEncrypted: encryptPii(cleanId),
                govtIdLast4: cleanId.slice(-4),
                farePaise: seat.farePaise
              };
            })
          }
        },
        include: {
          passengers: {
            include: {
              seat: { select: { seatNumber: true, cabinClass: true } }
            }
          }
        }
      });

      // 5. Immutable audit log
      await auditService.record(
        {
          actorId: meta.userId,
          actorRole: 'PASSENGER',
          entityType: 'BOOKING',
          entityId: booking.id,
          action: 'BOOKING_CREATED_PENDING',
          metadata: {
            pnr: booking.pnr,
            flightId,
            seatIds,
            totalAmountPaise
          },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return booking;
    });

    if (isRedisReady()) {
      const keys = seatIds.map((sid) => buildRedisLockKey(flightId, sid));
      await redis.del(...keys);
    }

    await flightService.invalidateSearchCache();

    await this.publishSeatEvent({
      type: 'SEAT_BOOKED',
      flightId,
      seatIds,
      timestamp: new Date().toISOString()
    });

    return {
      id: createdBooking.id,
      pnr: createdBooking.pnr,
      status: createdBooking.status,
      flightId: createdBooking.flightId,
      cabinClass: createdBooking.cabinClass,
      totalAmountPaise: createdBooking.totalAmountPaise,
      currency: createdBooking.currency,
      createdAt: createdBooking.createdAt.toISOString(),
      passengers: createdBooking.passengers.map((p) => ({
        id: p.id,
        seatId: p.seatId,
        seatNumber: p.seat.seatNumber,
        cabinClass: p.seat.cabinClass,
        fullName: decryptPii(p.fullNameEncrypted),
        age: p.age,
        gender: p.gender,
        govtIdType: p.govtIdType,
        govtIdMasked: maskGovtIdLast4(p.govtIdLast4),
        farePaise: p.farePaise
      }))
    };
  }

  /**
   * Passenger's own bookings list (FR-PAX-040, FR-PAX-042).
   */
  async listPassengerBookings(userId: string) {
    const bookings = await this.repo.findUserBookings(userId);
    return bookings.map((b) => ({
      id: b.id,
      pnr: b.pnr,
      status: b.status,
      cabinClass: b.cabinClass,
      totalAmountPaise: b.totalAmountPaise,
      currency: b.currency,
      createdAt: b.createdAt.toISOString(),
      confirmedAt: b.confirmedAt?.toISOString() ?? null,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      flight: {
        id: b.flight.id,
        flightNumber: b.flight.flightNumber,
        airlineName: b.flight.airlineName,
        origin: {
          iataCode: b.flight.originAirport.iataCode,
          cityName: b.flight.originAirport.city.name
        },
        destination: {
          iataCode: b.flight.destinationAirport.iataCode,
          cityName: b.flight.destinationAirport.city.name
        },
        departureTime: b.flight.departureTime.toISOString(),
        arrivalTime: b.flight.arrivalTime.toISOString(),
        durationMinutes: b.flight.durationMinutes
      },
      passengers: b.passengers.map((p) => ({
        id: p.id,
        seatNumber: p.seat.seatNumber,
        cabinClass: p.seat.cabinClass,
        fullName: decryptPii(p.fullNameEncrypted)
      })),
      tickets: b.tickets,
      latestPayment: b.paymentIntents[0] ?? null
    }));
  }

  /**
   * Single booking detail with strict 404 cross-tenant isolation (FR-XC-002, FR-PAX-042).
   */
  async getPassengerBookingDetail(bookingId: string, actor: AuthenticatedActor) {
    const booking = await this.repo.findBookingDetailById(bookingId);
    if (!booking) {
      throw AppError.notFound('Booking not found');
    }

    assertTenantOwnership(booking.userId, actor);

    return {
      id: booking.id,
      pnr: booking.pnr,
      status: booking.status,
      cabinClass: booking.cabinClass,
      totalAmountPaise: booking.totalAmountPaise,
      currency: booking.currency,
      createdAt: booking.createdAt.toISOString(),
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      flight: {
        id: booking.flight.id,
        flightNumber: booking.flight.flightNumber,
        airlineName: booking.flight.airlineName,
        origin: {
          iataCode: booking.flight.originAirport.iataCode,
          airportName: booking.flight.originAirport.name,
          cityName: booking.flight.originAirport.city.name
        },
        destination: {
          iataCode: booking.flight.destinationAirport.iataCode,
          airportName: booking.flight.destinationAirport.name,
          cityName: booking.flight.destinationAirport.city.name
        },
        departureTime: booking.flight.departureTime.toISOString(),
        arrivalTime: booking.flight.arrivalTime.toISOString(),
        durationMinutes: booking.flight.durationMinutes
      },
      passengers: booking.passengers.map((p) => ({
        id: p.id,
        seatId: p.seatId,
        seatNumber: p.seat.seatNumber,
        cabinClass: p.seat.cabinClass,
        fullName: decryptPii(p.fullNameEncrypted),
        age: p.age,
        gender: p.gender,
        govtIdType: p.govtIdType,
        govtIdNumber: decryptPii(p.govtIdNumberEncrypted),
        farePaise: p.farePaise,
        status: p.status
      })),
      tickets: booking.tickets,
      payments: booking.paymentIntents,
      refunds: booking.refunds
    };
  }

  /**
   * Enforces booking immutability (FR-PAX-024, BR-10).
   */
  async rejectBookingMutation(bookingId: string, actor: AuthenticatedActor): Promise<never> {
    const booking = await this.repo.findBookingDetailById(bookingId);
    if (!booking) {
      throw AppError.notFound('Booking not found');
    }
    assertTenantOwnership(booking.userId, actor);

    throw AppError.badRequest(
      ErrorCode.BOOKING_IMMUTABLE,
      'Bookings cannot be modified once created; use cancellation if eligible'
    );
  }

  // ============================================================================
  // ADMIN OVERSIGHT, PII MASKING/UNMASKING & REVENUE DASHBOARD (FR-ADM-011..015)
  // ============================================================================

  async listAdminBookingsMasked(query: AdminBookingListQuery) {
    const { items, total } = await this.repo.findAdminBookingsPaginated(query);

    const data = items.map((b) => {
      const profile = b.user.passengerProfile;
      return {
        id: b.id,
        pnr: b.pnr,
        status: b.status,
        cabinClass: b.cabinClass,
        totalAmountPaise: b.totalAmountPaise,
        currency: b.currency,
        createdAt: b.createdAt.toISOString(),
        confirmedAt: b.confirmedAt?.toISOString() ?? null,
        flight: {
          id: b.flight.id,
          flightNumber: b.flight.flightNumber,
          route: `${b.flight.originAirport.iataCode}->${b.flight.destinationAirport.iataCode}`,
          departureTime: b.flight.departureTime.toISOString()
        },
        accountContactMasked: {
          phone: profile ? maskPhoneLast4(profile.phoneLast4) : null,
          email: profile ? maskEmailDomain(profile.emailDomain) : null
        },
        passengers: b.passengers.map((p) => ({
          id: p.id,
          seatNumber: p.seat.seatNumber,
          fullNameMasked: maskFullName(decryptPii(p.fullNameEncrypted)),
          govtIdType: p.govtIdType,
          govtIdMasked: maskGovtIdLast4(p.govtIdLast4)
        }))
      };
    });

    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit)
      }
    };
  }

  /**
   * Unmasks passenger PII for a specific booking after logging mandatory audit reason (FR-ADM-012).
   */
  async unmaskBookingPiiForAdmin(
    bookingId: string,
    reason: string,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const booking = await this.repo.findBookingDetailById(bookingId);
    if (!booking) {
      throw AppError.notFound('Booking not found');
    }

    // Write audit log BEFORE returning unmasked PII (FR-ADM-012)
    await auditService.record({
      actorId: meta.adminUserId,
      actorRole: 'ADMIN',
      entityType: 'BOOKING_PII',
      entityId: booking.id,
      action: 'ADMIN_BOOKING_PII_UNMASKED',
      reason,
      metadata: { pnr: booking.pnr },
      ipAddress: meta.ipAddress,
      requestId: meta.requestId
    });

    const profile = booking.user.passengerProfile;
    const rawPhone = profile ? decryptPii(profile.phoneEncrypted) : null;

    return {
      bookingId: booking.id,
      pnr: booking.pnr,
      accountHolder: {
        fullName: profile?.fullNameEncrypted ? decryptPii(profile.fullNameEncrypted) : null,
        phone: rawPhone && !rawPhone.startsWith('EMAIL_ONLY_') ? rawPhone : null,
        email: profile?.emailEncrypted ? decryptPii(profile.emailEncrypted) : null
      },
      passengers: booking.passengers.map((p) => ({
        id: p.id,
        seatNumber: p.seat.seatNumber,
        fullName: decryptPii(p.fullNameEncrypted),
        age: p.age,
        gender: p.gender,
        govtIdType: p.govtIdType,
        govtIdNumber: decryptPii(p.govtIdNumberEncrypted)
      }))
    };
  }

  async exportAdminBookingsCsv(query: AdminBookingListQuery): Promise<string> {
    const rows = await this.repo.findAdminBookingsForExport(query);
    const headers = [
      'bookingId',
      'pnr',
      'status',
      'flightNumber',
      'route',
      'departureTime',
      'cabinClass',
      'passengerCount',
      'totalAmountPaise',
      'contactPhoneMasked',
      'createdAt'
    ];

    const lines = [headers.join(',')];
    for (const b of rows) {
      const phoneMasked = b.user.passengerProfile
        ? maskPhoneLast4(b.user.passengerProfile.phoneLast4)
        : '';
      lines.push(
        [
          b.id,
          b.pnr,
          b.status,
          b.flight.flightNumber,
          `${b.flight.originAirport.iataCode}-${b.flight.destinationAirport.iataCode}`,
          b.flight.departureTime.toISOString(),
          b.cabinClass,
          b.passengers.length,
          b.totalAmountPaise,
          phoneMasked,
          b.createdAt.toISOString()
        ].join(',')
      );
    }

    return lines.join('\n');
  }

  /**
   * Admin revenue dashboard (FR-ADM-015): daily totals, per-flight, per-class, and refunds.
   */
  async getRevenueDashboard() {
    const [confirmedBookings, refundTotals, byClass] = await Promise.all([
      prisma.booking.findMany({
        where: { status: 'CONFIRMED' },
        select: {
          id: true,
          totalAmountPaise: true,
          cabinClass: true,
          confirmedAt: true,
          createdAt: true,
          flight: {
            select: {
              id: true,
              flightNumber: true,
              originAirport: { select: { iataCode: true } },
              destinationAirport: { select: { iataCode: true } }
            }
          }
        }
      }),
      prisma.refund.aggregate({
        where: { status: { in: ['INITIATED', 'PROCESSING', 'COMPLETED'] } },
        _sum: { amountPaise: true },
        _count: { id: true }
      }),
      prisma.booking.groupBy({
        by: ['cabinClass'],
        where: { status: 'CONFIRMED' },
        _sum: { totalAmountPaise: true },
        _count: { id: true }
      })
    ]);

    let totalRevenuePaise = 0;
    const dailyMap = new Map<string, { date: string; bookings: number; revenuePaise: number }>();
    const flightMap = new Map<
      string,
      { flightId: string; flightNumber: string; route: string; bookings: number; revenuePaise: number }
    >();

    for (const b of confirmedBookings) {
      totalRevenuePaise += b.totalAmountPaise;
      const dayKey = (b.confirmedAt ?? b.createdAt).toISOString().slice(0, 10);
      const dayEntry = dailyMap.get(dayKey) ?? { date: dayKey, bookings: 0, revenuePaise: 0 };
      dayEntry.bookings += 1;
      dayEntry.revenuePaise += b.totalAmountPaise;
      dailyMap.set(dayKey, dayEntry);

      const fEntry = flightMap.get(b.flight.id) ?? {
        flightId: b.flight.id,
        flightNumber: b.flight.flightNumber,
        route: `${b.flight.originAirport.iataCode}->${b.flight.destinationAirport.iataCode}`,
        bookings: 0,
        revenuePaise: 0
      };
      fEntry.bookings += 1;
      fEntry.revenuePaise += b.totalAmountPaise;
      flightMap.set(b.flight.id, fEntry);
    }

    return {
      summary: {
        confirmedBookingsCount: confirmedBookings.length,
        totalRevenuePaise,
        totalRefundsCount: refundTotals._count.id,
        totalRefundedPaise: refundTotals._sum.amountPaise ?? 0,
        netRevenuePaise: totalRevenuePaise - (refundTotals._sum.amountPaise ?? 0)
      },
      daily: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      byFlight: Array.from(flightMap.values()).sort((a, b) => b.revenuePaise - a.revenuePaise),
      byCabinClass: byClass.map((c) => ({
        cabinClass: c.cabinClass,
        bookings: c._count.id,
        revenuePaise: c._sum.totalAmountPaise ?? 0
      }))
    };
  }

  /**
   * Internal helper used by Payment webhook worker (Wave 4A) to confirm a PENDING booking.
   */
  async confirmBookingInternal(bookingId: string, tx: Prisma.TransactionClient) {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: { passengers: true }
    });
    if (!booking) throw AppError.notFound('Booking not found');
    if (booking.status === 'CONFIRMED') return booking;
    if (booking.status !== 'PENDING') {
      throw AppError.badRequest(
        ErrorCode.INVALID_TRANSITION,
        `Cannot confirm booking in ${booking.status} state`
      );
    }

    return tx.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date()
      },
      include: { passengers: true }
    });
  }
}

export const bookingService = new BookingService();