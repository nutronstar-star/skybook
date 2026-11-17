import {
  prisma,
  encryptPii,
  blindIndexPii,
  type Prisma,
  type OtpChallenge,
  type User,
  type PassengerProfile,
  type AdminProfile,
  type Session,
  type PasswordReset
} from '@skybook/database';

export class IdentityRepository {
  async countRecentOtpRequests(targetHash: string, since: Date): Promise<number> {
    return prisma.otpChallenge.count({
      where: {
        targetHash,
        createdAt: { gte: since }
      }
    });
  }

  async createOtpChallenge(data: {
    channel: 'PHONE' | 'EMAIL';
    targetHash: string;
    otpHash: string;
    expiresAt: Date;
  }): Promise<OtpChallenge> {
    return prisma.otpChallenge.create({ data });
  }

  async findLatestActiveOtpChallenge(
    channel: 'PHONE' | 'EMAIL',
    targetHash: string
  ): Promise<OtpChallenge | null> {
    return prisma.otpChallenge.findFirst({
      where: {
        channel,
        targetHash,
        consumedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async recordFailedOtpAttempt(
    id: string,
    attempts: number,
    lockedUntil: Date | null
  ): Promise<void> {
    await prisma.otpChallenge.update({
      where: { id },
      data: { attempts, lockedUntil }
    });
  }

  async consumeOtpChallenge(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? prisma;
    await client.otpChallenge.update({
      where: { id },
      data: { consumedAt: new Date() }
    });
  }

  async findPassengerByPhoneHash(
    phoneHash: string
  ): Promise<(PassengerProfile & { user: User }) | null> {
    return prisma.passengerProfile.findUnique({
      where: { phoneHash },
      include: { user: true }
    });
  }

  async findPassengerByEmailHash(
    emailHash: string
  ): Promise<(PassengerProfile & { user: User }) | null> {
    return prisma.passengerProfile.findUnique({
      where: { emailHash },
      include: { user: true }
    });
  }

  async createPassengerWithPhone(
    input: { phone: string; fullName?: string },
    tx?: Prisma.TransactionClient
  ): Promise<User & { passengerProfile: PassengerProfile | null }> {
    const client = tx ?? prisma;
    const last4 = input.phone.slice(-4);
    return client.user.create({
      data: {
        role: 'PASSENGER',
        passengerProfile: {
          create: {
            phoneEncrypted: encryptPii(input.phone),
            phoneHash: blindIndexPii(input.phone),
            phoneLast4: last4,
            ...(input.fullName ? { fullNameEncrypted: encryptPii(input.fullName) } : {})
          }
        }
      },
      include: { passengerProfile: true }
    });
  }

  async createPassengerWithEmail(
    input: { email: string; fullName?: string },
    tx?: Prisma.TransactionClient
  ): Promise<User & { passengerProfile: PassengerProfile | null }> {
    const client = tx ?? prisma;
    const emailDomain = input.email.split('@')[1] ?? null;
    const placeholderPhone = `EMAIL_ONLY_${blindIndexPii(input.email).slice(0, 16)}`;
    return client.user.create({
      data: {
        role: 'PASSENGER',
        passengerProfile: {
          create: {
            phoneEncrypted: encryptPii(placeholderPhone),
            phoneHash: blindIndexPii(placeholderPhone),
            phoneLast4: '0000',
            emailEncrypted: encryptPii(input.email),
            emailHash: blindIndexPii(input.email),
            emailDomain,
            ...(input.fullName ? { fullNameEncrypted: encryptPii(input.fullName) } : {})
          }
        }
      },
      include: { passengerProfile: true }
    });
  }

  async getPassengerProfileByUserId(userId: string) {
    return prisma.passengerProfile.findUnique({
      where: { userId },
      include: {
        user: {
          include: {
            _count: { select: { bookings: true } }
          }
        }
      }
    });
  }

  async updatePassengerProfile(
    userId: string,
    data: {
      fullNameEncrypted?: string;
      emailEncrypted?: string;
      emailHash?: string;
      emailDomain?: string | null;
    },
    tx?: Prisma.TransactionClient
  ): Promise<PassengerProfile> {
    const client = tx ?? prisma;
    return client.passengerProfile.update({
      where: { userId },
      data
    });
  }

  async findAdminByEmail(email: string): Promise<(AdminProfile & { user: User }) | null> {
    return prisma.adminProfile.findUnique({
      where: { email },
      include: { user: true }
    });
  }

  async createSession(
    data: {
      id: string;
      userId: string;
      refreshTokenHash: string;
      userAgent?: string | null;
      ipAddress?: string | null;
      expiresAt: Date;
    },
    tx?: Prisma.TransactionClient
  ): Promise<Session> {
    const client = tx ?? prisma;
    return client.session.create({ data });
  }

  async findSessionById(id: string): Promise<Session | null> {
    return prisma.session.findUnique({ where: { id } });
  }

  async rotateSessionRefreshToken(
    id: string,
    newRefreshTokenHash: string,
    newExpiresAt: Date
  ): Promise<Session> {
    return prisma.session.update({
      where: { id },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt: newExpiresAt
      }
    });
  }

  async revokeSingleSession(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? prisma;
    await client.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async revokeAllUserSessions(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? prisma;
    await client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async createPasswordReset(
    adminProfileId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<PasswordReset> {
    return prisma.passwordReset.create({
      data: { adminProfileId, tokenHash, expiresAt }
    });
  }

  async findPasswordResetByHash(
    tokenHash: string
  ): Promise<(PasswordReset & { adminProfile: AdminProfile }) | null> {
    return prisma.passwordReset.findUnique({
      where: { tokenHash },
      include: { adminProfile: true }
    });
  }

  async completeAdminPasswordReset(
    input: {
      resetId: string;
      adminProfileId: string;
      newPasswordHash: string;
    },
    tx: Prisma.TransactionClient
  ): Promise<void> {
    await tx.passwordReset.update({
      where: { id: input.resetId },
      data: { usedAt: new Date() }
    });
    await tx.adminProfile.update({
      where: { id: input.adminProfileId },
      data: { passwordHash: input.newPasswordHash }
    });
  }
}