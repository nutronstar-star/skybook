import { prisma } from '@skybook/database';
import { ErrorCode } from '@skybook/shared';
import { AppError } from '../../shared/errors/app-error.js';
import { redis, isRedisReady } from '../../shared/redis/client.js';
import { auditService } from '../audit/index.js';
import { FlightRepository } from './flight.repository.js';
import type {
  CreateAircraftTypeSchema,
  CreateAirportSchema,
  CreateCitySchema,
  CreateFlightSchema,
  FlightCancelledHook,
  FlightSearchParams,
  TimeOfDay,
  UpdateAirportSchema,
  UpdateCitySchema,
  UpdateFlightSchema,
  UpdateSeatLayoutsSchema
} from './flight.types.js';
import type { z } from 'zod';

const SEARCH_VERSION_KEY = 'flights:search:version';
const SEARCH_CACHE_TTL_SECONDS = 30;

function matchesTimeOfDay(date: Date, window: TimeOfDay): boolean {
  // Convert to IST (+05:30) hour for domestic flight time-of-day filtering
  const istMs = date.getTime() + 330 * 60_000;
  const hour = new Date(istMs).getUTCHours();
  if (window === 'MORNING') return hour >= 6 && hour < 12;
  if (window === 'AFTERNOON') return hour >= 12 && hour < 18;
  if (window === 'EVENING') return hour >= 18 && hour <= 23;
  return hour >= 0 && hour < 6;
}

export class FlightService {
  private readonly cancellationHooks: FlightCancelledHook[] = [];

  constructor(private readonly repo = new FlightRepository()) {}

  onFlightCancelled(hook: FlightCancelledHook): void {
    this.cancellationHooks.push(hook);
  }

  async invalidateSearchCache(): Promise<void> {
    if (!isRedisReady()) return;
    await redis.incr(SEARCH_VERSION_KEY);
  }

  private async getSearchCacheVersion(): Promise<string> {
    if (!isRedisReady()) return '0';
    const ver = await redis.get(SEARCH_VERSION_KEY);
    return ver ?? '0';
  }

  async autocomplete(q: string) {
    const airports = await this.repo.autocompleteAirports(q);
    return airports.map((a) => ({
      airportId: a.id,
      iataCode: a.iataCode,
      airportName: a.name,
      cityId: a.city.id,
      cityName: a.city.name,
      state: a.city.state,
      country: a.city.country
    }));
  }

  private async searchSingleLeg(params: {
    origin: string;
    destination: string;
    date: string;
    cabinClass?: 'ECONOMY' | 'BUSINESS';
    timeOfDay?: TimeOfDay;
    sortBy: 'price' | 'departure' | 'duration';
    sortOrder: 'asc' | 'desc';
  }) {
    if (params.origin === params.destination) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Origin and destination airports must be different'
      );
    }

    const version = await this.getSearchCacheVersion();
    const cacheKey = `flights:search:v${version}:${params.origin}:${params.destination}:${params.date}:${params.cabinClass ?? 'ALL'}:${params.timeOfDay ?? 'ALL'}:${params.sortBy}:${params.sortOrder}`;

    if (isRedisReady()) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as unknown[];
      }
    }

    const flights = await this.repo.findPublishedFlightsOnDate(
      params.origin,
      params.destination,
      params.date
    );

    const mapped = flights
      .filter((f) => (params.timeOfDay ? matchesTimeOfDay(f.departureTime, params.timeOfDay) : true))
      .map((f) => {
        const lockedSet = new Set(f.seatLocks.map((l) => l.seatId));
        let economyAvailable = 0;
        let businessAvailable = 0;

        for (const s of f.flightSeats) {
          if (s.status === 'AVAILABLE' && !lockedSet.has(s.id)) {
            if (s.cabinClass === 'ECONOMY') economyAvailable++;
            else businessAvailable++;
          }
        }

        const totalAvailable = economyAvailable + businessAvailable;
        const effectiveFarePaise =
          params.cabinClass === 'BUSINESS' ? f.businessBasePaise : f.economyBasePaise;

        return {
          id: f.id,
          flightNumber: f.flightNumber,
          airlineName: f.airlineName,
          origin: {
            iataCode: f.originAirport.iataCode,
            airportName: f.originAirport.name,
            cityName: f.originAirport.city.name
          },
          destination: {
            iataCode: f.destinationAirport.iataCode,
            airportName: f.destinationAirport.name,
            cityName: f.destinationAirport.city.name
          },
          aircraft: f.aircraftType,
          departureTime: f.departureTime.toISOString(),
          arrivalTime: f.arrivalTime.toISOString(),
          durationMinutes: f.durationMinutes,
          economyBasePaise: f.economyBasePaise,
          businessBasePaise: f.businessBasePaise,
          effectiveFarePaise,
          seatsAvailable: {
            total: totalAvailable,
            economy: economyAvailable,
            business: businessAvailable
          },
          status: f.status
        };
      })
      .filter((item) => {
        if (params.cabinClass === 'ECONOMY') return item.seatsAvailable.economy > 0;
        if (params.cabinClass === 'BUSINESS') return item.seatsAvailable.business > 0;
        return item.seatsAvailable.total > 0;
      });

    const dir = params.sortOrder === 'asc' ? 1 : -1;
    mapped.sort((a, b) => {
      if (params.sortBy === 'price') return (a.effectiveFarePaise - b.effectiveFarePaise) * dir;
      if (params.sortBy === 'duration') return (a.durationMinutes - b.durationMinutes) * dir;
      return (new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime()) * dir;
    });

    if (isRedisReady()) {
      await redis.set(cacheKey, JSON.stringify(mapped), 'EX', SEARCH_CACHE_TTL_SECONDS);
    }

    return mapped;
  }

  async searchFlights(params: FlightSearchParams) {
    const outbound = await this.searchSingleLeg({
      origin: params.origin,
      destination: params.destination,
      date: params.date,
      cabinClass: params.cabinClass,
      timeOfDay: params.timeOfDay,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder
    });

    if (!params.returnDate) {
      return {
        tripType: 'ONE_WAY' as const,
        outbound
      };
    }

    const inbound = await this.searchSingleLeg({
      origin: params.destination,
      destination: params.origin,
      date: params.returnDate,
      cabinClass: params.cabinClass,
      timeOfDay: params.timeOfDay,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder
    });

    return {
      tripType: 'ROUND_TRIP' as const,
      outbound,
      inbound
    };
  }

  async getFlightDetails(flightId: string, includeDraft = false) {
    const flight = await this.repo.findFlightById(flightId);
    if (!flight || (!includeDraft && flight.status !== 'PUBLISHED')) {
      throw AppError.notFound('Flight not found');
    }
    return flight;
  }

  async getSeatMap(flightId: string) {
    const { flight, seats, activeLocks } = await this.repo.findFlightSeatMap(flightId);
    if (!flight || flight.status !== 'PUBLISHED') {
      throw AppError.notFound('Flight not found');
    }

    const lockExpiryMap = new Map(activeLocks.map((l) => [l.seatId, l.expiresAt.toISOString()]));

    return {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      aircraft: flight.aircraftType,
      economyBasePaise: flight.economyBasePaise,
      businessBasePaise: flight.businessBasePaise,
      seats: seats.map((s) => {
        const activeLockExpiry = lockExpiryMap.get(s.id);
        const effectiveStatus =
          s.status === 'BOOKED'
            ? 'BOOKED'
            : s.status === 'LOCKED' || activeLockExpiry
              ? 'LOCKED'
              : 'AVAILABLE';

        return {
          id: s.id,
          seatNumber: s.seatNumber,
          rowNumber: s.rowNumber,
          columnLetter: s.columnLetter,
          cabinClass: s.cabinClass,
          farePaise: s.farePaise,
          status: effectiveStatus,
          isExitRow: s.isExitRow,
          isWindow: s.isWindow,
          ...(activeLockExpiry ? { lockedUntil: activeLockExpiry } : {})
        };
      })
    };
  }

  // ============================================================================
  // ADMIN FLIGHT & CATALOG OPERATIONS (FR-ADM-004..010)
  // ============================================================================

  async listAdminFlights(query: Parameters<FlightRepository['listAdminFlights']>[0]) {
    const { items, total } = await this.repo.listAdminFlights(query);
    return {
      data: items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit)
      }
    };
  }

  async createFlight(
    input: z.infer<typeof CreateFlightSchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    if (input.originAirportId === input.destinationAirportId) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Origin and destination airports must differ'
      );
    }

    const dep = new Date(input.departureTime);
    const arr = new Date(input.arrivalTime);
    if (arr <= dep) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Arrival time must be after departure time'
      );
    }

    const durationMinutes = Math.round((arr.getTime() - dep.getTime()) / 60_000);

    const created = await prisma.$transaction(async (tx) => {
      const [origin, dest, aircraft] = await Promise.all([
        tx.airport.findUnique({ where: { id: input.originAirportId } }),
        tx.airport.findUnique({ where: { id: input.destinationAirportId } }),
        tx.aircraftType.findUnique({
          where: { id: input.aircraftTypeId },
          include: { seatLayouts: true }
        })
      ]);

      if (!origin || !dest) {
        throw AppError.badRequest(ErrorCode.VALIDATION_ERROR, 'Invalid origin or destination airport');
      }
      if (!aircraft || aircraft.seatLayouts.length === 0) {
        throw AppError.badRequest(ErrorCode.VALIDATION_ERROR, 'Invalid aircraft type or missing seat layout');
      }

      const flight = await tx.flight.create({
        data: {
          flightNumber: input.flightNumber,
          airlineName: input.airlineName,
          originAirportId: input.originAirportId,
          destinationAirportId: input.destinationAirportId,
          aircraftTypeId: input.aircraftTypeId,
          departureTime: dep,
          arrivalTime: arr,
          durationMinutes,
          economyBasePaise: input.economyBasePaise,
          businessBasePaise: input.businessBasePaise,
          status: 'DRAFT'
        }
      });

      await tx.flightSeat.createMany({
        data: aircraft.seatLayouts.map((layout) => ({
          flightId: flight.id,
          seatNumber: layout.seatNumber,
          rowNumber: layout.rowNumber,
          columnLetter: layout.columnLetter,
          cabinClass: layout.cabinClass,
          farePaise:
            layout.cabinClass === 'BUSINESS' ? input.businessBasePaise : input.economyBasePaise,
          status: 'AVAILABLE',
          isExitRow: layout.isExitRow,
          isWindow: layout.isWindow
        }))
      });

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'FLIGHT',
          entityId: flight.id,
          action: 'FLIGHT_CREATED',
          reason: input.reason,
          metadata: { flightNumber: flight.flightNumber, status: 'DRAFT' },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return flight;
    });

    return created;
  }

  async updateFlight(
    flightId: string,
    input: z.infer<typeof UpdateFlightSchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const existing = await this.repo.findFlightById(flightId);
    if (!existing) {
      throw AppError.notFound('Flight not found');
    }

    // FR-ADM-005: Cannot edit flight details once bookings exist on it
    if (existing._count.bookings > 0) {
      throw AppError.badRequest(
        ErrorCode.BOOKING_IMMUTABLE,
        'Cannot modify flight details after passenger bookings exist'
      );
    }

    const dep = input.departureTime ? new Date(input.departureTime) : existing.departureTime;
    const arr = input.arrivalTime ? new Date(input.arrivalTime) : existing.arrivalTime;
    if (arr <= dep) {
      throw AppError.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Arrival time must be after departure time'
      );
    }
    const durationMinutes = Math.round((arr.getTime() - dep.getTime()) / 60_000);

    const updated = await prisma.$transaction(async (tx) => {
      const flight = await tx.flight.update({
        where: { id: flightId },
        data: {
          ...(input.flightNumber ? { flightNumber: input.flightNumber } : {}),
          ...(input.airlineName ? { airlineName: input.airlineName } : {}),
          departureTime: dep,
          arrivalTime: arr,
          durationMinutes,
          ...(input.economyBasePaise ? { economyBasePaise: input.economyBasePaise } : {}),
          ...(input.businessBasePaise ? { businessBasePaise: input.businessBasePaise } : {})
        }
      });

      if (input.economyBasePaise) {
        await tx.flightSeat.updateMany({
          where: { flightId, cabinClass: 'ECONOMY' },
          data: { farePaise: input.economyBasePaise }
        });
      }
      if (input.businessBasePaise) {
        await tx.flightSeat.updateMany({
          where: { flightId, cabinClass: 'BUSINESS' },
          data: { farePaise: input.businessBasePaise }
        });
      }

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'FLIGHT',
          entityId: flightId,
          action: 'FLIGHT_UPDATED',
          reason: input.reason,
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return flight;
    });

    await this.invalidateSearchCache();
    return updated;
  }

  async publishFlight(
    flightId: string,
    reason: string,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const existing = await prisma.flight.findUnique({ where: { id: flightId } });
    if (!existing) {
      throw AppError.notFound('Flight not found');
    }
    if (existing.status !== 'DRAFT') {
      throw AppError.badRequest(
        ErrorCode.INVALID_TRANSITION,
        `Only DRAFT flights can be published (current: ${existing.status})`
      );
    }

    const published = await prisma.$transaction(async (tx) => {
      const flight = await tx.flight.update({
        where: { id: flightId },
        data: { status: 'PUBLISHED' }
      });

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'FLIGHT',
          entityId: flightId,
          action: 'FLIGHT_PUBLISHED',
          reason,
          metadata: { flightNumber: flight.flightNumber },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return flight;
    });

    await this.invalidateSearchCache();
    return published;
  }

  async cancelFlight(
    flightId: string,
    reason: string,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const existing = await prisma.flight.findUnique({ where: { id: flightId } });
    if (!existing) {
      throw AppError.notFound('Flight not found');
    }
    if (existing.status === 'CANCELLED') {
      throw AppError.badRequest(ErrorCode.INVALID_TRANSITION, 'Flight is already cancelled');
    }

    const cancelled = await prisma.$transaction(async (tx) => {
      const flight = await tx.flight.update({
        where: { id: flightId },
        data: { status: 'CANCELLED' }
      });

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'FLIGHT',
          entityId: flightId,
          action: 'FLIGHT_CANCELLED',
          reason,
          metadata: { flightNumber: flight.flightNumber },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return flight;
    });

    await this.invalidateSearchCache();

    for (const hook of this.cancellationHooks) {
      await hook({
        flightId: cancelled.id,
        flightNumber: cancelled.flightNumber,
        adminUserId: meta.adminUserId,
        reason
      });
    }

    return cancelled;
  }

  // Cities, Airports & Aircraft Types (FR-ADM-009, FR-ADM-010)
  async listCities() {
    return this.repo.listCities();
  }

  async createCity(
    input: z.infer<typeof CreateCitySchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const city = await tx.city.create({
        data: { name: input.name, state: input.state, country: input.country }
      });
      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'CITY',
          entityId: city.id,
          action: 'CITY_CREATED',
          reason: input.reason,
          metadata: { name: city.name },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
      return city;
    });
  }

  async updateCity(
    cityId: string,
    input: z.infer<typeof UpdateCitySchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const existing = await prisma.city.findUnique({ where: { id: cityId } });
    if (!existing) throw AppError.notFound('City not found');

    const updated = await prisma.$transaction(async (tx) => {
      const city = await tx.city.update({
        where: { id: cityId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
        }
      });
      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'CITY',
          entityId: cityId,
          action: 'CITY_UPDATED',
          reason: input.reason,
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
      return city;
    });

    await this.invalidateSearchCache();
    return updated;
  }

  async createAirport(
    input: z.infer<typeof CreateAirportSchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const airport = await tx.airport.create({
        data: {
          cityId: input.cityId,
          iataCode: input.iataCode,
          name: input.name
        }
      });
      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'AIRPORT',
          entityId: airport.id,
          action: 'AIRPORT_CREATED',
          reason: input.reason,
          metadata: { iataCode: airport.iataCode },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
      return airport;
    });
  }

  async updateAirport(
    airportId: string,
    input: z.infer<typeof UpdateAirportSchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const existing = await prisma.airport.findUnique({ where: { id: airportId } });
    if (!existing) throw AppError.notFound('Airport not found');

    const updated = await prisma.$transaction(async (tx) => {
      const airport = await tx.airport.update({
        where: { id: airportId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
        }
      });
      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'AIRPORT',
          entityId: airportId,
          action: 'AIRPORT_UPDATED',
          reason: input.reason,
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
      return airport;
    });

    await this.invalidateSearchCache();
    return updated;
  }

  async listAircraftTypes() {
    return this.repo.listAircraftTypes();
  }

  async createAircraftType(
    input: z.infer<typeof CreateAircraftTypeSchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const businessSeats = input.layouts.filter((l) => l.cabinClass === 'BUSINESS').length;
    const economySeats = input.layouts.filter((l) => l.cabinClass === 'ECONOMY').length;

    return prisma.$transaction(async (tx) => {
      const aircraft = await tx.aircraftType.create({
        data: {
          code: input.code,
          name: input.name,
          totalSeats: input.layouts.length,
          businessSeats,
          economySeats,
          seatLayouts: {
            create: input.layouts.map((l) => ({
              seatNumber: l.seatNumber,
              rowNumber: l.rowNumber,
              columnLetter: l.columnLetter,
              cabinClass: l.cabinClass,
              isExitRow: l.isExitRow,
              isWindow: l.isWindow
            }))
          }
        },
        include: { _count: { select: { seatLayouts: true } } }
      });

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'AIRCRAFT_TYPE',
          entityId: aircraft.id,
          action: 'AIRCRAFT_TYPE_CREATED',
          reason: input.reason,
          metadata: { code: aircraft.code, totalSeats: aircraft.totalSeats },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return aircraft;
    });
  }

  async updateAircraftSeatLayouts(
    aircraftTypeId: string,
    input: z.infer<typeof UpdateSeatLayoutsSchema>,
    meta: { adminUserId: string; ipAddress?: string; requestId?: string }
  ) {
    const existing = await prisma.aircraftType.findUnique({ where: { id: aircraftTypeId } });
    if (!existing) throw AppError.notFound('Aircraft type not found');

    const businessSeats = input.layouts.filter((l) => l.cabinClass === 'BUSINESS').length;
    const economySeats = input.layouts.filter((l) => l.cabinClass === 'ECONOMY').length;

    return prisma.$transaction(async (tx) => {
      await tx.seatLayout.deleteMany({ where: { aircraftTypeId } });
      await tx.seatLayout.createMany({
        data: input.layouts.map((l) => ({
          aircraftTypeId,
          seatNumber: l.seatNumber,
          rowNumber: l.rowNumber,
          columnLetter: l.columnLetter,
          cabinClass: l.cabinClass,
          isExitRow: l.isExitRow,
          isWindow: l.isWindow
        }))
      });

      const updated = await tx.aircraftType.update({
        where: { id: aircraftTypeId },
        data: {
          totalSeats: input.layouts.length,
          businessSeats,
          economySeats
        }
      });

      await auditService.record(
        {
          actorId: meta.adminUserId,
          actorRole: 'ADMIN',
          entityType: 'AIRCRAFT_TYPE',
          entityId: aircraftTypeId,
          action: 'AIRCRAFT_LAYOUTS_UPDATED',
          reason: input.reason,
          metadata: { totalSeats: updated.totalSeats },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return updated;
    });
  }
}

export const flightService = new FlightService();