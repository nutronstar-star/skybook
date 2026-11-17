import { prisma, type Prisma } from '@skybook/database';
import type { AdminBookingListQuery } from './booking.types.js';

export class BookingRepository {
  async findPublishedFlightWithSeats(flightId: string, seatIds: string[]) {
    const flight = await prisma.flight.findUnique({
      where: { id: flightId },
      select: { id: true, status: true, departureTime: true }
    });
    if (!flight || flight.status !== 'PUBLISHED') {
      return null;
    }

    const seats = await prisma.flightSeat.findMany({
      where: {
        flightId,
        id: { in: seatIds }
      }
    });

    return { flight, seats };
  }

  async findActiveLocksByGroupId(lockGroupId: string) {
    return prisma.seatLock.findMany({
      where: {
        lockGroupId,
        status: 'LOCKED'
      },
      include: {
        seat: true,
        flight: true
      }
    });
  }

  async findActiveLockGroupsForUser(userId: string) {
    const now = new Date();
    return prisma.seatLock.findMany({
      where: {
        userId,
        status: 'LOCKED',
        expiresAt: { gt: now }
      },
      include: {
        seat: {
          select: {
            id: true,
            seatNumber: true,
            cabinClass: true,
            farePaise: true
          }
        },
        flight: {
          select: {
            id: true,
            flightNumber: true,
            departureTime: true,
            arrivalTime: true,
            originAirport: { select: { iataCode: true } },
            destinationAirport: { select: { iataCode: true } }
          }
        }
      },
      orderBy: { expiresAt: 'asc' }
    });
  }

  async findUserBookings(userId: string) {
    return prisma.booking.findMany({
      where: { userId },
      include: {
        flight: {
          include: {
            originAirport: { include: { city: true } },
            destinationAirport: { include: { city: true } }
          }
        },
        passengers: {
          include: {
            seat: { select: { seatNumber: true, cabinClass: true } }
          }
        },
        tickets: {
          select: {
            id: true,
            seatLabel: true,
            status: true,
            issuedAt: true
          }
        },
        paymentIntents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, razorpayOrderId: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findBookingDetailById(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: {
          include: {
            passengerProfile: true
          }
        },
        flight: {
          include: {
            originAirport: { include: { city: true } },
            destinationAirport: { include: { city: true } }
          }
        },
        passengers: {
          include: {
            seat: { select: { seatNumber: true, cabinClass: true, rowNumber: true, columnLetter: true } }
          }
        },
        tickets: true,
        paymentIntents: {
          orderBy: { createdAt: 'desc' }
        },
        refunds: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
  }

  private buildAdminWhere(query: AdminBookingListQuery): Prisma.BookingWhereInput {
    const where: Prisma.BookingWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.flightId) where.flightId = query.flightId;
    if (query.pnr) where.pnr = { contains: query.pnr, mode: 'insensitive' };
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
        ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } : {})
      };
    }
    return where;
  }

  async findAdminBookingsPaginated(query: AdminBookingListQuery) {
    const where = this.buildAdminWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: { include: { passengerProfile: true } },
          flight: {
            select: {
              id: true,
              flightNumber: true,
              departureTime: true,
              originAirport: { select: { iataCode: true } },
              destinationAirport: { select: { iataCode: true } }
            }
          },
          passengers: {
            include: {
              seat: { select: { seatNumber: true } }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit
      }),
      prisma.booking.count({ where })
    ]);

    return { items, total };
  }

  async findAdminBookingsForExport(query: AdminBookingListQuery, maxRows = 5000) {
    const where = this.buildAdminWhere(query);
    return prisma.booking.findMany({
      where,
      include: {
        user: { include: { passengerProfile: true } },
        flight: {
          select: {
            flightNumber: true,
            departureTime: true,
            originAirport: { select: { iataCode: true } },
            destinationAirport: { select: { iataCode: true } }
          }
        },
        passengers: true
      },
      orderBy: { createdAt: 'desc' },
      take: maxRows
    });
  }
}