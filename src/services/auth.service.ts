import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/index.js';
import { env } from '../lib/env.js';
import { resolveUserPermissions } from './permission.service.js';

const COOKIE_NAME = 'indexcore_session';
const BCRYPT_ROUNDS = 10;

export type SessionPayload = {
  sessionId: string;
  userId: string;
};

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plain, passwordHash);
}

export async function setUserPassword(userId: string, plain: string) {
  const passwordHash = await hashPassword(plain);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  ip?: string,
  userAgent?: string,
): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + env.sessionMaxAgeHours * 60 * 60 * 1000);

  const session = await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ipAddress: ip,
      userAgent,
      expiresAt,
    },
  });

  return { sessionId: session.id, token, expiresAt };
}

export function signSessionCookie(sessionId: string, userId: string): string {
  return jwt.sign({ sessionId, userId } satisfies SessionPayload, env.sessionSecret, {
    expiresIn: `${env.sessionMaxAgeHours}h`,
  });
}

export function verifySessionCookie(cookie: string): SessionPayload | null {
  try {
    return jwt.verify(cookie, env.sessionSecret) as SessionPayload;
  } catch {
    return null;
  }
}

export async function getUserFromSession(sessionId: string, userId: string) {
  const session = await prisma.userSession.findFirst({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });
  return session?.user ?? null;
}

export async function loginWithPassword(
  email: string,
  password: string,
  ip?: string,
  userAgent?: string,
) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    throw new Error('Credenciais inválidas');
  }
  if (user.status !== 'active') {
    throw new Error('Usuário inativo');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new Error('Credenciais inválidas');
  }

  const { sessionId } = await createSession(user.id, ip, userAgent);
  return { user, sessionId };
}

export async function logoutUser(sessionId: string) {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function buildUserWithPermissions(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const permissions = await resolveUserPermissions(userId);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    mfaRequired: user.mfaRequired,
    mfaVerified: true,
    permissions,
  };
}

export { COOKIE_NAME };
