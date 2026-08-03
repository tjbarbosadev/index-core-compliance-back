import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { COOKIE_NAME, loginWithPassword, signSessionCookie } from '../services/auth.service.js';
import { env } from '../lib/env.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function registerAuthRoutes(app: Express) {
  app.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const body = loginSchema.parse(req.body);
      const { user, sessionId } = await loginWithPassword(
        body.email,
        body.password,
        req.ip,
        req.get('user-agent') ?? undefined,
      );
      const cookie = signSessionCookie(sessionId, user.id);
      res.cookie(COOKIE_NAME, cookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.nodeEnv === 'production',
        maxAge: env.sessionMaxAgeHours * 60 * 60 * 1000,
      });
      res.json({ success: true, userId: user.id, name: user.name });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'E-mail e senha (mín. 8 caracteres) são obrigatórios' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Erro no login';
      const status =
        message === 'Credenciais inválidas' || message === 'Usuário inativo' ? 401 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
