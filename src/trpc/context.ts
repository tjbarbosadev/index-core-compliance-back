import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { prisma } from '../db/index.js';
import { COOKIE_NAME, getUserFromSession, verifySessionCookie } from '../services/auth.service.js';
import { resolveUserPermissions } from '../services/permission.service.js';

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const cookie = req.cookies?.[COOKIE_NAME] as string | undefined;
  let user: Awaited<ReturnType<typeof getUserFromSession>> = null;
  let permissions: string[] = [];
  let sessionId: string | undefined;

  if (cookie) {
    const payload = verifySessionCookie(cookie);
    if (payload) {
      sessionId = payload.sessionId;
      user = await getUserFromSession(payload.sessionId, payload.userId);
      if (user) {
        permissions = await resolveUserPermissions(user.id);
      }
    }
  }

  return {
    req,
    res,
    prisma,
    user,
    permissions,
    sessionId,
    ip: req.ip,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
