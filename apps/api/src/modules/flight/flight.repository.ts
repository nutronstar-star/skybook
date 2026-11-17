import { prisma, type Prisma } from '@skybook/database';
import type { AdminFlightListQuerySchema } from './flight.types.js';
import type { z } from 'zod';

export class FlightRepository {
  async autocompleteAirports(q: string, limit = 10) {
    return prisma.airport.findMany({
      where: {
        isActive: true,
        city: { isActive: true },
        OR: [
          { iataCode: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { city: { name: { contains: q, mode: 'insensitive' } } }
        ]
      },
      include: {
        city: {
          select: { id: true, name: true, state: true, country: true }
        }
      },
      orderBy: [{ iataCode: 'asc' }],
      take: limit
    });
  }

  async findPublishedFlightsOnDate(originIata: string, destinationIata: string, dateYmd: string) {
    const startOfDay = new Date(`${dateYmd}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateYmd}T23:59:59.999Z`);

    return prisma.flight.findMany({
      where: {
        status: 'PUBLISHED',
        originAirport: { iataCode: originIata, isActive: true },
        destinationAirport: { iataCode: destinationIata, isActive: true },
        departureTime: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      include: {
        originAirport: { include: { city: true } },
        destinationAirport: { include: { city: true } },
        aircraftType: { select: { code: true, name: true, totalSeats: true } },
        flightSeats: {
          select: {
            id: true,
            cabinClass: true,
            status: true
          }
        },
        seatLocks: {
          where: {
            status: 'LOCKED',
            expiresAt: { gt: new Date() }
          },
          select: { seatId: true }
        }
      },
      orderBy: { departureTime: 'asc' }
    });
  }

  async findFlightById(flightId: string) {
    return prisma.flight.findUnique({
      where: { id: flightId },
      include: {
        originAirport: { include: { city: true } },
        destinationAirport: { include: { city: true } },
        aircraftType: true,
        _count: {
          select: {
            bookings: { where: { status: { in: ['PENDING', 'CONFIRMED'] } } }
          }
        }
      }
    });
  }

  async findFlightSeatMap(flightId: string) {
    const now = new Date();
    const [flight, seats, activeLocks] = await Promise.all([
      prisma.flight.findUnique({
        where: { id: flightId },
        include: {
          originAirport: { include: { city: true } },
          destinationAirport: { include: { city: true } },
          aircraftType: true
        }
      }),
      prisma.flightSeat.findMany({
        where: { flightId },
        orderBy: [{ rowNumber: 'asc' }, { columnLetter: 'asc' }]
      }),
      prisma.seatLock.findMany({
        where: {
          flightId,
          status: 'LOCKED',
          expiresAt: { gt: now }
        },
        select: { seatId: true, expiresAt: true }
      })
    ]);

    return { flight, seats, activeLocks };
  }

  async listAdminFlights(query: z.infer<typeof AdminFlightListQuerySchema>) {
    const where: Prisma.FlightWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.origin ? { originAirport: { iataCode: query.origin } } : {}),
      ...(query.destination ? { destinationAirport: { iataCode: query.destination } } : {})
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      prisma.flight.findMany({
        where,
        include: {
          originAirport: { include: { city: true } },
          destinationAirport: { include: { city: true } },
          aircraftType: { select: { code: true, name: true, totalSeats: true } },
          _count: {
            select: {
              bookings: true,
              flightSeats: { where: { status: 'AVAILABLE' } }
            }
          }
        },
        orderBy: { departureTime: 'asc' },
        skip,
        take: query.limit
      }),
      prisma.flight.count({ where })
    ]);

    return { items, total };
  }

  async listCities() {
    return prisma.city.findMany({
      include: { airports: true },
      orderBy: { name: 'asc' }
    });
  }

  async listAircraftTypes() {
    return prisma.aircraftType.findMany({
      include: {
        _count: { select: { seatLayouts: true, flights: true } }
      },
      orderBy: { code: 'asc' }
    });
  }
}