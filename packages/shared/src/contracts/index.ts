import { z } from 'zod';
import { DOMAIN_CONSTANTS } from '../constants/domain.js';

export const PhoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian E.164 phone number (+91XXXXXXXXXX)');

export const AirportCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter IATA airport code');

export const CabinClassSchema = z.enum(['ECONOMY', 'BUSINESS']);
export type CabinClass = z.infer<typeof CabinClassSchema>;

export const BookingStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const PaymentStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const RefundStatusSchema = z.enum(['INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED']);
export type RefundStatus = z.infer<typeof RefundStatusSchema>;

export const FlightStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']);
export type FlightStatus = z.infer<typeof FlightStatusSchema>;

export const OtpRequestSchema = z.object({
  phone: PhoneSchema
});

export const OtpVerifySchema = z.object({
  phone: PhoneSchema,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  fullName: z.string().trim().min(2).max(100).optional()
});

export const AdminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(DOMAIN_CONSTANTS.ADMIN_MIN_PASSWORD_LENGTH)
});

export const FlightSearchQuerySchema = z.object({
  origin: AirportCodeSchema,
  destination: AirportCodeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  cabinClass: CabinClassSchema.optional(),
  sortBy: z.enum(['price', 'departure', 'duration']).default('departure'),
  sortOrder: z.enum(['asc', 'desc']).default('asc')
});

export const SeatLockRequestSchema = z.object({
  flightId: z.string().uuid(),
  seatIds: z
    .array(z.string().uuid())
    .min(1)
    .max(DOMAIN_CONSTANTS.MAX_SEATS_PER_BOOKING)
});

export const BookingPassengerInputSchema = z.object({
  seatId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(100),
  age: z.number().int().min(1).max(120),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  govtIdType: z.enum(['AADHAAR', 'PASSPORT', 'PAN', 'DRIVING_LICENSE']),
  govtIdNumber: z.string().trim().min(4).max(32)
});

export const CreateBookingSchema = z.object({
  lockId: z.string().uuid(),
  cabinClass: CabinClassSchema,
  passengers: z
    .array(BookingPassengerInputSchema)
    .min(1)
    .max(DOMAIN_CONSTANTS.MAX_SEATS_PER_BOOKING)
});

export const CreatePaymentOrderSchema = z.object({
  bookingId: z.string().uuid()
});

export const AdminReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Audit reason must be at least 5 characters').max(500)
});