import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import {
  prisma,
  blindIndexPii,
  decryptPii,
  encryptPii,
  type Prisma
} from '@skybook/database';
import { DOMAIN_CONSTANTS, ErrorCode } from '@skybook/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../shared/security/jwt.js';
import {
  markSessionRevoked,
  revokeAllUserSessionsAfter
} from '../../shared/redis/client.js';
import { auditService } from '../audit/index.js';
import { IdentityRepository } from './identity.repository.js';
import type { AuthTokenBundle, RequestMeta } from './identity.types.js';

const DUMMY_ADMIN_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2t5Ym9va2R1bW15c2FsdA$1234567890abcdef1234567890abcdef1234567890a';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeHashEquals(aHex: string, bHex: string): boolean {
  const aBuf = Buffer.from(aHex, 'hex');
  const bBuf = Buffer.from(bHex, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export class IdentityService {
  constructor(private readonly repo = new IdentityRepository()) {}

  private async issueSessionTokens(
    userId: string,
    role: 'PASSENGER' | 'ADMIN',
    meta: RequestMeta,
    tx?: Prisma.TransactionClient
  ): Promise<AuthTokenBundle> {
    const sessionId = randomUUID();
    const refreshToken = await signRefreshToken({ userId, sessionId });
    const accessToken = await signAccessToken({ userId, sessionId, role });
    const expiresAt = new Date(Date.now() + DOMAIN_CONSTANTS.REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.repo.createSession(
      {
        id: sessionId,
        userId,
        refreshTokenHash: sha256Hex(refreshToken),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt
      },
      tx
    );

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: DOMAIN_CONSTANTS.ACCESS_TOKEN_TTL_SECONDS,
      user: { id: userId, role }
    };
  }

  async requestOtp(channel: 'PHONE' | 'EMAIL', target: string) {
    const targetHash = blindIndexPii(target);
    const tenMinutesAgo = new Date(Date.now() - DOMAIN_CONSTANTS.OTP_TTL_SECONDS * 1000);
    const recentCount = await this.repo.countRecentOtpRequests(targetHash, tenMinutesAgo);

    if (recentCount >= DOMAIN_CONSTANTS.OTP_RATE_LIMIT_PER_10_MIN) {
      throw AppError.tooManyRequests('OTP rate limit exceeded (max 3 requests per 10 minutes)');
    }

    const otp = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + DOMAIN_CONSTANTS.OTP_TTL_SECONDS * 1000);

    await this.repo.createOtpChallenge({
      channel,
      targetHash,
      otpHash: sha256Hex(otp),
      expiresAt
    });

    return {
      sent: true,
      channel,
      expiresInSeconds: DOMAIN_CONSTANTS.OTP_TTL_SECONDS,
      ...(env.MOCK_OTP ? { mockOtp: otp } : {})
    };
  }

  async verifyOtpAndLogin(
    input: {
      channel: 'PHONE' | 'EMAIL';
      target: string;
      otp: string;
      fullName?: string;
    },
    meta: RequestMeta
  ): Promise<AuthTokenBundle> {
    const targetHash = blindIndexPii(input.target);
    const challenge = await this.repo.findLatestActiveOtpChallenge(input.channel, targetHash);

    if (!challenge) {
      throw AppError.badRequest(ErrorCode.INVALID_OTP, 'Invalid or expired OTP');
    }

    const now = new Date();
    if (challenge.lockedUntil && challenge.lockedUntil > now) {
      throw AppError.badRequest(
        ErrorCode.OTP_LOCKED,
        'OTP verification locked due to too many failed attempts'
      );
    }

    if (challenge.expiresAt <= now) {
      throw AppError.badRequest(ErrorCode.OTP_EXPIRED, 'OTP has expired');
    }

    const candidateHash = sha256Hex(input.otp);
    if (!safeHashEquals(candidateHash, challenge.otpHash)) {
      const nextAttempts = challenge.attempts + 1;
      const lockedUntil =
        nextAttempts >= DOMAIN_CONSTANTS.OTP_MAX_ATTEMPTS
          ? new Date(Date.now() + DOMAIN_CONSTANTS.OTP_LOCKOUT_SECONDS * 1000)
          : null;

      await this.repo.recordFailedOtpAttempt(challenge.id, nextAttempts, lockedUntil);

      if (lockedUntil) {
        throw AppError.badRequest(
          ErrorCode.OTP_LOCKED,
          'Maximum OTP attempts reached; locked for 15 minutes'
        );
      }
      throw AppError.badRequest(ErrorCode.INVALID_OTP, 'Invalid OTP');
    }

    return prisma.$transaction(async (tx) => {
      await this.repo.consumeOtpChallenge(challenge.id, tx);

      let userId: string;
      let isNewUser = false;

      if (input.channel === 'PHONE') {
        const existing = await this.repo.findPassengerByPhoneHash(targetHash);
        if (existing) {
          userId = existing.userId;
        } else {
          const created = await this.repo.createPassengerWithPhone(
            { phone: input.target, fullName: input.fullName },
            tx
          );
          userId = created.id;
          isNewUser = true;
        }
      } else {
        const existing = await this.repo.findPassengerByEmailHash(targetHash);
        if (existing) {
          userId = existing.userId;
        } else {
          const created = await this.repo.createPassengerWithEmail(
            { email: input.target, fullName: input.fullName },
            tx
          );
          userId = created.id;
          isNewUser = true;
        }
      }

      const tokens = await this.issueSessionTokens(userId, 'PASSENGER', meta, tx);

      await auditService.record(
        {
          actorId: userId,
          actorRole: 'PASSENGER',
          entityType: 'USER',
          entityId: userId,
          action: isNewUser ? 'PASSENGER_REGISTERED_AND_LOGIN' : 'PASSENGER_OTP_LOGIN',
          metadata: { channel: input.channel },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );

      return tokens;
    });
  }

  async refreshSession(rawRefreshToken: string): Promise<AuthTokenBundle> {
    let claims: { sub: string; sid: string };
    try {
      claims = await verifyRefreshToken(rawRefreshToken);
    } catch {
      throw AppError.unauthorized('Refresh token is invalid or expired');
    }

    const session = await this.repo.findSessionById(claims.sid);
    if (!session || session.userId !== claims.sub || session.revokedAt !== null) {
      throw AppError.unauthorized('Session has been revoked');
    }

    if (session.expiresAt <= new Date()) {
      throw AppError.unauthorized('Refresh token has expired');
    }

    if (!safeHashEquals(sha256Hex(rawRefreshToken), session.refreshTokenHash)) {
      await this.repo.revokeSingleSession(session.id);
      await markSessionRevoked(session.id, DOMAIN_CONSTANTS.ACCESS_TOKEN_TTL_SECONDS);
      throw AppError.unauthorized('Refresh token reuse detected');
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) {
      throw AppError.unauthorized('User account is inactive');
    }

    const newRefreshToken = await signRefreshToken({ userId: user.id, sessionId: session.id });
    const newAccessToken = await signAccessToken({
      userId: user.id,
      sessionId: session.id,
      role: user.role
    });
    const newExpiresAt = new Date(Date.now() + DOMAIN_CONSTANTS.REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.repo.rotateSessionRefreshToken(session.id, sha256Hex(newRefreshToken), newExpiresAt);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresInSeconds: DOMAIN_CONSTANTS.ACCESS_TOKEN_TTL_SECONDS,
      user: { id: user.id, role: user.role }
    };
  }

  async logoutSession(
    actor: { userId: string; sessionId: string; role: 'PASSENGER' | 'ADMIN' },
    meta: RequestMeta
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await this.repo.revokeSingleSession(actor.sessionId, tx);
      await auditService.record(
        {
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: 'SESSION',
          entityId: actor.sessionId,
          action: 'USER_LOGOUT',
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
    });

    await markSessionRevoked(actor.sessionId, DOMAIN_CONSTANTS.ACCESS_TOKEN_TTL_SECONDS);
  }

  async getMyPassengerProfile(userId: string) {
    const profile = await this.repo.getPassengerProfileByUserId(userId);
    if (!profile) {
      throw AppError.notFound('Passenger profile not found');
    }

    const rawPhone = decryptPii(profile.phoneEncrypted);
    const phone = rawPhone.startsWith('EMAIL_ONLY_') ? null : rawPhone;

    return {
      userId: profile.userId,
      fullName: profile.fullNameEncrypted ? decryptPii(profile.fullNameEncrypted) : null,
      phone,
      email: profile.emailEncrypted ? decryptPii(profile.emailEncrypted) : null,
      bookingCount: profile.user._count.bookings,
      consentGivenAt: profile.consentGivenAt.toISOString(),
      createdAt: profile.createdAt.toISOString()
    };
  }

  async updateMyPassengerProfile(
    userId: string,
    input: { fullName?: string; email?: string; phone?: unknown },
    meta: RequestMeta
  ) {
    if (input.phone !== undefined) {
      throw AppError.badRequest(
        ErrorCode.PHONE_IMMUTABLE,
        'Phone number cannot be changed after registration'
      );
    }

    const updateData: {
      fullNameEncrypted?: string;
      emailEncrypted?: string;
      emailHash?: string;
      emailDomain?: string | null;
    } = {};

    if (input.fullName !== undefined) {
      updateData.fullNameEncrypted = encryptPii(input.fullName);
    }

    if (input.email !== undefined) {
      updateData.emailEncrypted = encryptPii(input.email);
      updateData.emailHash = blindIndexPii(input.email);
      updateData.emailDomain = input.email.split('@')[1] ?? null;
    }

    await prisma.$transaction(async (tx) => {
      await this.repo.updatePassengerProfile(userId, updateData, tx);
      await auditService.record(
        {
          actorId: userId,
          actorRole: 'PASSENGER',
          entityType: 'PASSENGER_PROFILE',
          entityId: userId,
          action: 'PASSENGER_PROFILE_UPDATED',
          metadata: {
            updatedFields: Object.keys(updateData)
          },
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
    });

    return this.getMyPassengerProfile(userId);
  }

  async adminLogin(
    input: { email: string; password: string },
    meta: RequestMeta
  ): Promise<AuthTokenBundle> {
    if (input.password.length < DOMAIN_CONSTANTS.ADMIN_MIN_PASSWORD_LENGTH) {
      throw AppError.badRequest(
        ErrorCode.PASSWORD_TOO_SHORT,
        `Admin password must be at least ${DOMAIN_CONSTANTS.ADMIN_MIN_PASSWORD_LENGTH} characters`
      );
    }

    const admin = await this.repo.findAdminByEmail(input.email);
    const hashToCheck = admin ? admin.passwordHash : DUMMY_ADMIN_HASH;

    let passwordValid = false;
    try {
      passwordValid = await argon2.verify(hashToCheck, input.password);
    } catch {
      passwordValid = false;
    }

    if (!admin || !admin.user.isActive || !passwordValid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    return prisma.$transaction(async (tx) => {
      const tokens = await this.issueSessionTokens(admin.userId, 'ADMIN', meta, tx);
      await auditService.record(
        {
          actorId: admin.userId,
          actorRole: 'ADMIN',
          entityType: 'USER',
          entityId: admin.userId,
          action: 'ADMIN_LOGIN',
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
      return tokens;
    });
  }

  async requestAdminPasswordReset(email: string, meta: RequestMeta) {
    const admin = await this.repo.findAdminByEmail(email);
    let rawToken: string | undefined;

    if (admin && admin.user.isActive) {
      rawToken = randomBytes(32).toString('hex');
      const expiresAt = new Date(
        Date.now() + DOMAIN_CONSTANTS.ADMIN_RESET_TOKEN_TTL_SECONDS * 1000
      );
      await this.repo.createPasswordReset(admin.id, sha256Hex(rawToken), expiresAt);

      await auditService.record({
        actorId: admin.userId,
        actorRole: 'ADMIN',
        entityType: 'ADMIN_PROFILE',
        entityId: admin.id,
        action: 'ADMIN_PASSWORD_RESET_REQUESTED',
        ipAddress: meta.ipAddress,
        requestId: meta.requestId
      });
    }

    return {
      accepted: true,
      message: 'If an admin account matches that email, a reset link has been issued',
      ...(env.MOCK_OTP && rawToken ? { mockResetToken: rawToken } : {})
    };
  }

  async confirmAdminPasswordReset(
    input: { token: string; newPassword: string },
    meta: RequestMeta
  ): Promise<void> {
    const resetRecord = await this.repo.findPasswordResetByHash(sha256Hex(input.token));
    if (!resetRecord || resetRecord.usedAt !== null || resetRecord.expiresAt <= new Date()) {
      throw AppError.badRequest(
        ErrorCode.RESET_TOKEN_INVALID,
        'Password reset token is invalid, expired, or already used'
      );
    }

    const newPasswordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4
    });

    const adminUserId = resetRecord.adminProfile.userId;

    await prisma.$transaction(async (tx) => {
      await this.repo.completeAdminPasswordReset(
        {
          resetId: resetRecord.id,
          adminProfileId: resetRecord.adminProfileId,
          newPasswordHash
        },
        tx
      );

      await this.repo.revokeAllUserSessions(adminUserId, tx);

      await auditService.record(
        {
          actorId: adminUserId,
          actorRole: 'ADMIN',
          entityType: 'USER',
          entityId: adminUserId,
          action: 'ADMIN_PASSWORD_RESET_COMPLETED',
          reason: 'Password reset via single-use token',
          ipAddress: meta.ipAddress,
          requestId: meta.requestId
        },
        tx
      );
    });

    await revokeAllUserSessionsAfter(adminUserId, DOMAIN_CONSTANTS.ACCESS_TOKEN_TTL_SECONDS);
  }
}

export const identityService = new IdentityService();