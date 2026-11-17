export const DOMAIN_CONSTANTS = {
  SEAT_LOCK_TTL_SECONDS: 300,
  MAX_SEATS_PER_BOOKING: 6,

  OTP_LENGTH: 6,
  OTP_TTL_SECONDS: 600,
  OTP_MAX_ATTEMPTS: 5,
  OTP_LOCKOUT_SECONDS: 900,
  OTP_RATE_LIMIT_PER_10_MIN: 3,

  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_SECONDS: 604_800,
  ADMIN_MIN_PASSWORD_LENGTH: 16,
  ADMIN_RESET_TOKEN_TTL_SECONDS: 900,

  RATE_LIMIT_AUTH_PER_MIN: 10,
  RATE_LIMIT_WRITE_PER_MIN: 60,
  RATE_LIMIT_READ_PER_MIN: 300,

  IDEMPOTENCY_TTL_SECONDS: 86_400,
  PNR_LENGTH: 6
} as const;

export function calculateRefundPercentage(hoursBeforeDeparture: number): number {
  if (hoursBeforeDeparture >= 72) return 90;
  if (hoursBeforeDeparture >= 24) return 75;
  if (hoursBeforeDeparture >= 4) return 50;
  return 0;
}