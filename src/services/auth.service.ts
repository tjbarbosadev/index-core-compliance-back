import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/index.js';
import { env } from '../lib/env.js';
import { resolveUserPermissions } from './permission.service.js';

const COOKIE_NAME = 'indexcore_session';

export type SessionPayload = {
  sessionId: string;
  userId: string;
};

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
    include: {
      user: {
        include: {
          userGroups: { include: { group: true } },
        },
      },
    },
  });
  return session?.user ?? null;
}

export async function loginByGroupName(groupName: string, ip?: string, userAgent?: string) {
  const group = await prisma.permissionGroup.findUnique({ where: { name: groupName } });
  if (!group) throw new Error('Grupo não encontrado');

  const email = `${groupName.toLowerCase().replace(/\s+/g, '.')}@indexcore.local`;
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: groupName,
        isAdmin: groupName === 'Administrador',
        mfaRequired: false,
      },
    });
  }

  await prisma.userGroup.upsert({
    where: { userId_groupId: { userId: user.id, groupId: group.id } },
    update: {},
    create: { userId: user.id, groupId: group.id },
  });

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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { userGroups: { include: { group: true } } },
  });
  if (!user) return null;

  const permissions = await resolveUserPermissions(userId);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    mfaRequired: false,
    mfaVerified: true,
    groups: user.userGroups.map((ug) => ({ id: ug.group.id, name: ug.group.name })),
    permissions,
  };
}

export { COOKIE_NAME };
