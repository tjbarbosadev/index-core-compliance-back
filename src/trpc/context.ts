import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { prisma } from '../db/index.js';
import { COOKIE_NAME, getUserFromSession, verifySessionCookie } from '../services/auth.service.js';
import { resolveUserPermissions } from '../services/permission.service.js';
import {
  authenticatePartnerBearer,
  type AuthenticatedPartner,
} from '../services/partner.service.js';

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const cookie = req.cookies?.[COOKIE_NAME] as string | undefined;
  let user: Awaited<ReturnType<typeof getUserFromSession>> = null;
  let permissions: string[] = [];
  let sessionId: string | undefined;
  let partner: AuthenticatedPartner | null = null;
  let serviceAuth = false;

  const authHeader = req.headers.authorization;
  partner = await authenticatePartnerBearer(
    typeof authHeader === 'string' ? authHeader : undefined,
  );
  if (partner) {
    serviceAuth = true;
    permissions = ['cotistas.read'];
  }

  if (!serviceAuth && cookie) {
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
    partner,
    serviceAuth,
    ip: req.ip,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
