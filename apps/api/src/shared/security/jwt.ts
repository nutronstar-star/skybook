import { SignJWT, jwtVerify } from 'jose';
import { DOMAIN_CONSTANTS } from '@skybook/shared';
import { env } from '../../config/env.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: 'PASSENGER' | 'ADMIN';
  iat?: number;
  exp?: number;
}

const accessSecretKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecretKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export async function signAccessToken(payload: {
  userId: string;
  sessionId: string;
  role: 'PASSENGER' | 'ADMIN';
}): Promise<string> {
  return new SignJWT({ sid: payload.sessionId, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${DOMAIN_CONSTANTS.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessSecretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, accessSecretKey, {
    algorithms: ['HS256']
  });
  if (!payload.sub || typeof payload.sid !== 'string' || (payload.role !== 'PASSENGER' && payload.role !== 'ADMIN')) {
    throw new Error('Invalid token claims');
  }
  return {
    sub: payload.sub,
    sid: payload.sid,
    role: payload.role,
    iat: payload.iat,
    exp: payload.exp
  };
}

export async function signRefreshToken(payload: {
  userId: string;
  sessionId: string;
}): Promise<string> {
  return new SignJWT({ sid: payload.sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${DOMAIN_CONSTANTS.REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(refreshSecretKey);
}

export async function verifyRefreshToken(token: string): Promise<{ sub: string; sid: string }> {
  const { payload } = await jwtVerify(token, refreshSecretKey, {
    algorithms: ['HS256']
  });
  if (!payload.sub || typeof payload.sid !== 'string') {
    throw new Error('Invalid refresh token claims');
  }
  return { sub: payload.sub, sid: payload.sid };
}