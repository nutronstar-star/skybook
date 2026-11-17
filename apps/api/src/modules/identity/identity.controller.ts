import type { FastifyReply, FastifyRequest } from 'fastify';
import { DOMAIN_CONSTANTS } from '@skybook/shared';
import { AppError } from '../../shared/errors/app-error.js';
import { identityService } from './identity.service.js';
import {
  AdminLoginRequestSchema,
  AdminPasswordResetConfirmSchema,
  AdminPasswordResetRequestSchema,
  EmailOtpRequestSchema,
  EmailOtpVerifySchema,
  PhoneOtpRequestSchema,
  PhoneOtpVerifySchema,
  RefreshSessionSchema,
  UpdatePassengerProfileSchema,
  type RequestMeta
} from './identity.types.js';

function getRequestMeta(request: FastifyRequest): RequestMeta {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: request.id
  };
}

function attachRefreshCookie(reply: FastifyReply, refreshToken: string): void {
  void reply.setCookie('skybook_refresh', refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/v1/auth',
    maxAge: DOMAIN_CONSTANTS.REFRESH_TOKEN_TTL_SECONDS
  });
}

export class IdentityController {
  async requestPhoneOtp(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = PhoneOtpRequestSchema.parse(request.body);
    const result = await identityService.requestOtp('PHONE', body.phone);
    return reply.status(200).send(result);
  }

  async verifyPhoneOtp(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = PhoneOtpVerifySchema.parse(request.body);
    const tokens = await identityService.verifyOtpAndLogin(
      {
        channel: 'PHONE',
        target: body.phone,
        otp: body.otp,
        fullName: body.fullName
      },
      getRequestMeta(request)
    );
    attachRefreshCookie(reply, tokens.refreshToken);
    return reply.status(200).send(tokens);
  }

  async requestEmailOtp(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = EmailOtpRequestSchema.parse(request.body);
    const result = await identityService.requestOtp('EMAIL', body.email);
    return reply.status(200).send(result);
  }

  async verifyEmailOtp(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = EmailOtpVerifySchema.parse(request.body);
    const tokens = await identityService.verifyOtpAndLogin(
      {
        channel: 'EMAIL',
        target: body.email,
        otp: body.otp,
        fullName: body.fullName
      },
      getRequestMeta(request)
    );
    attachRefreshCookie(reply, tokens.refreshToken);
    return reply.status(200).send(tokens);
  }

  async refresh(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const parsed = RefreshSessionSchema.parse(request.body ?? {});
    const cookieToken = request.cookies?.skybook_refresh;
    const rawToken = parsed.refreshToken ?? cookieToken;

    if (!rawToken) {
      throw AppError.unauthorized('Refresh token is required');
    }

    const tokens = await identityService.refreshSession(rawToken);
    attachRefreshCookie(reply, tokens.refreshToken);
    return reply.status(200).send(tokens);
  }

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const actor = request.authUser!;
    await identityService.logoutSession(actor, getRequestMeta(request));
    void reply.clearCookie('skybook_refresh', { path: '/v1/auth' });
    return reply.status(200).send({ loggedOut: true });
  }

  async getMe(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const actor = request.authUser!;
    const profile = await identityService.getMyPassengerProfile(actor.userId);
    return reply.status(200).send(profile);
  }

  async updateMe(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const actor = request.authUser!;
    const body = UpdatePassengerProfileSchema.parse(request.body);
    const updated = await identityService.updateMyPassengerProfile(
      actor.userId,
      body,
      getRequestMeta(request)
    );
    return reply.status(200).send(updated);
  }

  async adminLogin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = AdminLoginRequestSchema.parse(request.body);
    const tokens = await identityService.adminLogin(body, getRequestMeta(request));
    attachRefreshCookie(reply, tokens.refreshToken);
    return reply.status(200).send(tokens);
  }

  async requestAdminPasswordReset(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    const body = AdminPasswordResetRequestSchema.parse(request.body);
    const result = await identityService.requestAdminPasswordReset(
      body.email,
      getRequestMeta(request)
    );
    return reply.status(200).send(result);
  }

  async confirmAdminPasswordReset(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    const body = AdminPasswordResetConfirmSchema.parse(request.body);
    await identityService.confirmAdminPasswordReset(body, getRequestMeta(request));
    return reply.status(200).send({ passwordReset: true });
  }
}

export const identityController = new IdentityController();