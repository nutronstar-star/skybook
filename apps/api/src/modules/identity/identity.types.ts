import { z } from 'zod';
import { DOMAIN_CONSTANTS, PhoneSchema } from '@skybook/shared';

export const PhoneOtpRequestSchema = z.object({
  phone: PhoneSchema
});

export const PhoneOtpVerifySchema = z.object({
  phone: PhoneSchema,
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  fullName: z.string().trim().min(2).max(100).optional()
});

export const EmailOtpRequestSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase())
});

export const EmailOtpVerifySchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  fullName: z.string().trim().min(2).max(100).optional()
});

export const RefreshSessionSchema = z.object({
  refreshToken: z.string().min(20).optional()
});

export const UpdatePassengerProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  email: z.string().email().transform((v) => v.trim().toLowerCase()).optional(),
  phone: z.unknown().optional()
});

export const AdminLoginRequestSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1)
});

export const AdminPasswordResetRequestSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase())
});

export const AdminPasswordResetConfirmSchema = z.object({
  token: z.string().min(16),
  newPassword: z.string().min(DOMAIN_CONSTANTS.ADMIN_MIN_PASSWORD_LENGTH)
});

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    role: 'PASSENGER' | 'ADMIN';
  };
}