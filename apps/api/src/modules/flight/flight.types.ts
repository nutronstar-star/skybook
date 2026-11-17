import { z } from 'zod';
import { AirportCodeSchema, CabinClassSchema, FlightStatusSchema } from '@skybook/shared';

export const AutocompleteQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query must be at least 1 character').max(64)
});

export const TimeOfDaySchema = z.enum(['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

export const FlightSearchParamsSchema = z.object({
  origin: AirportCodeSchema,
  destination: AirportCodeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Return date must be YYYY-MM-DD')
    .optional(),
  cabinClass: CabinClassSchema.optional(),
  timeOfDay: TimeOfDaySchema.optional(),
  sortBy: z.enum(['price', 'departure', 'duration']).default('departure'),
  sortOrder: z.enum(['asc', 'desc']).default('asc')
});

export type FlightSearchParams = z.infer<typeof FlightSearchParamsSchema>;

export const FlightIdParamSchema = z.object({
  id: z.string().uuid()
});

export const AdminFlightListQuerySchema = z.object({
  status: FlightStatusSchema.optional(),
  origin: AirportCodeSchema.optional(),
  destination: AirportCodeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const CreateFlightSchema = z.object({
  flightNumber: z.string().trim().min(2).max(12).toUpperCase(),
  airlineName: z.string().trim().min(2).max(64).default('SkyBook Air'),
  originAirportId: z.string().uuid(),
  destinationAirportId: z.string().uuid(),
  aircraftTypeId: z.string().uuid(),
  departureTime: z.string().datetime(),
  arrivalTime: z.string().datetime(),
  economyBasePaise: z.number().int().min(50000),
  businessBasePaise: z.number().int().min(100000),
  reason: z.string().trim().min(5).max(500)
});

export const UpdateFlightSchema = z.object({
  flightNumber: z.string().trim().min(2).max(12).toUpperCase().optional(),
  airlineName: z.string().trim().min(2).max(64).optional(),
  departureTime: z.string().datetime().optional(),
  arrivalTime: z.string().datetime().optional(),
  economyBasePaise: z.number().int().min(50000).optional(),
  businessBasePaise: z.number().int().min(100000).optional(),
  reason: z.string().trim().min(5).max(500)
});

export const CreateCitySchema = z.object({
  name: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(80).default('India'),
  reason: z.string().trim().min(5).max(500)
});

export const UpdateCitySchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  state: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500)
});

export const CreateAirportSchema = z.object({
  cityId: z.string().uuid(),
  iataCode: AirportCodeSchema,
  name: z.string().trim().min(3).max(140),
  reason: z.string().trim().min(5).max(500)
});

export const UpdateAirportSchema = z.object({
  name: z.string().trim().min(3).max(140).optional(),
  isActive: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500)
});

export const SeatLayoutItemSchema = z.object({
  seatNumber: z.string().trim().min(2).max(5).toUpperCase(),
  rowNumber: z.number().int().min(1).max(100),
  columnLetter: z.string().trim().min(1).max(2).toUpperCase(),
  cabinClass: CabinClassSchema,
  isExitRow: z.boolean().default(false),
  isWindow: z.boolean().default(false)
});

export const CreateAircraftTypeSchema = z.object({
  code: z.string().trim().min(2).max(24).toUpperCase(),
  name: z.string().trim().min(2).max(80),
  layouts: z.array(SeatLayoutItemSchema).min(6).max(400),
  reason: z.string().trim().min(5).max(500)
});

export const UpdateSeatLayoutsSchema = z.object({
  layouts: z.array(SeatLayoutItemSchema).min(6).max(400),
  reason: z.string().trim().min(5).max(500)
});

export interface FlightCancelledEvent {
  flightId: string;
  flightNumber: string;
  adminUserId: string;
  reason: string;
}

export type FlightCancelledHook = (event: FlightCancelledEvent) => Promise<void>;