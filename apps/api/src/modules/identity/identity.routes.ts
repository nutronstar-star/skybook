import type { FastifyInstance } from 'fastify';
import { requireAuth, requirePassenger } from '../../shared/middleware/auth.middleware.js';
import { rateLimit } from '../../shared/middleware/rate-limit.middleware.js';
import { identityController } from './identity.controller.js';

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/otp/request',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Passenger'], summary: 'Request 6-digit phone OTP (FR-PAX-001)' }
    },
    (req, reply) => identityController.requestPhoneOtp(req, reply)
  );

  app.post(
    '/auth/otp/verify',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Passenger'], summary: 'Verify phone OTP & issue tokens (FR-PAX-001)' }
    },
    (req, reply) => identityController.verifyPhoneOtp(req, reply)
  );

  app.post(
    '/auth/email-otp/request',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Passenger'], summary: 'Request 6-digit email OTP (FR-PAX-002)' }
    },
    (req, reply) => identityController.requestEmailOtp(req, reply)
  );

  app.post(
    '/auth/email-otp/verify',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Passenger'], summary: 'Verify email OTP & issue tokens (FR-PAX-002)' }
    },
    (req, reply) => identityController.verifyEmailOtp(req, reply)
  );

  app.post(
    '/auth/refresh',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Session'], summary: 'Rotate refresh token & issue new access token (FR-PAX-003)' }
    },
    (req, reply) => identityController.refresh(req, reply)
  );

  app.post(
    '/auth/logout',
    {
      preHandler: [requireAuth, rateLimit('write')],
      schema: { tags: ['Auth · Session'], summary: 'Revoke current session only (FR-PAX-004)' }
    },
    (req, reply) => identityController.logout(req, reply)
  );

  app.get(
    '/users/me',
    {
      preHandler: [requirePassenger, rateLimit('read')],
      schema: { tags: ['Passenger · Profile'], summary: 'Get authenticated passenger profile (FR-PAX-040)' }
    },
    (req, reply) => identityController.getMe(req, reply)
  );

  app.patch(
    '/users/me',
    {
      preHandler: [requirePassenger, rateLimit('write')],
      schema: { tags: ['Passenger · Profile'], summary: 'Update name/email; phone is immutable (FR-PAX-005, 041)' }
    },
    (req, reply) => identityController.updateMe(req, reply)
  );

  app.post(
    '/auth/admin/login',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Admin'], summary: 'Admin login with Argon2id password (FR-ADM-001)' }
    },
    (req, reply) => identityController.adminLogin(req, reply)
  );

  app.post(
    '/auth/admin/password-reset/request',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Admin'], summary: 'Request single-use 15-min password reset token (FR-ADM-002)' }
    },
    (req, reply) => identityController.requestAdminPasswordReset(req, reply)
  );

  app.post(
    '/auth/admin/password-reset/confirm',
    {
      preHandler: [rateLimit('auth')],
      schema: { tags: ['Auth · Admin'], summary: 'Confirm admin password reset & revoke all sessions (FR-ADM-002, FR-XC-006)' }
    },
    (req, reply) => identityController.confirmAdminPasswordReset(req, reply)
  );
}