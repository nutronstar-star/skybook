import { z } from 'zod';

const stripQuotes = (v: string) => v.replace(/^["']+|["']+$/g, '').trim();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),

  PII_ENCRYPTION_KEY_HEX: z.string().length(64),

  TICKET_ED25519_PRIVATE_KEY_B64: z.string().default('').transform(stripQuotes),
  TICKET_ED25519_PUBLIC_KEY_B64: z.string().default('').transform(stripQuotes),

  MOCK_OTP: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),
  MOCK_PAYMENT: z
    .string()
    .default('true')
    .transform((v) => v.toLowerCase() === 'true'),

  RAZORPAY_KEY_ID: z.string().default(''),
  RAZORPAY_KEY_SECRET: z.string().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  PASSENGER_ORIGIN: z.string().default('http://localhost:3000'),
  ADMIN_ORIGIN: z.string().default('http://localhost:3001')
});

export type AppEnv = z.infer<typeof EnvSchema>;

export const env: AppEnv = EnvSchema.parse(process.env);