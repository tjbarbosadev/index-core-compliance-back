import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { COOKIE_NAME, loginByGroupName, signSessionCookie } from '../services/auth.service.js';
import { env } from '../lib/env.js';

const loginSchema = z.object({
  groupName: z.string().min(1),
});

export function registerAuthRoutes(app: Express) {
  app.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const body = loginSchema.parse(req.body);
      const { user, sessionId } = await loginByGroupName(
        body.groupName,
        req.ip,
        req.get('user-agent') ?? undefined,
      );
      const cookie = signSessionCookie(sessionId, user.id);
      res.cookie(COOKIE_NAME, cookie, {
        httpOnly: true,
        sameSite: 'strict',
        secure: env.nodeEnv === 'production',
        maxAge: env.sessionMaxAgeHours * 60 * 60 * 1000,
      });
      res.json({ success: true, userId: user.id, name: user.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro no login';
      res.status(400).json({ error: message });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
