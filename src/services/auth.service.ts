import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/index.js';
import { env } from '../lib/env.js';
import { resolveUserPermissions } from './permission.service.js';
import { maskEmail, sendPasswordResetEmail } from './email.service.js';

const COOKIE_NAME = 'indexcore_session';
const BCRYPT_ROUNDS = 10;

export type SessionPayload = {
  sessionId: string;
  userId: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

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
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
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

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'Se o e-mail estiver cadastrado, enviaremos instruções para redefinir a senha.';

/** Cria token de redefinição/convite e retorna a URL pública. */
export async function issuePasswordResetUrl(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt,
    },
  });

  return `${env.webUrl}/redefinir-senha?token=${rawToken}`;
}

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  const normalized = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  if (!user) {
    console.info('[auth] forgot-password', { email: maskEmail(normalized), reason: 'no_user' });
    return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
  }
  if (user.status !== 'active') {
    console.info('[auth] forgot-password', { email: maskEmail(normalized), reason: 'inactive' });
    return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
  }

  const resetUrl = await issuePasswordResetUrl(user.id);
  const result = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl,
  });

  console.info('[auth] forgot-password', {
    email: maskEmail(normalized),
    reason: result.reason,
    sent: result.sent,
    hasPassword: Boolean(user.passwordHash),
  });

  return { message: FORGOT_PASSWORD_GENERIC_MESSAGE };
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!record || record.user.status !== 'active') {
    throw new Error('Link inválido ou expirado');
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: now },
    }),
    prisma.userSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
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
