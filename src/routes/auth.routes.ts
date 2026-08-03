import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  COOKIE_NAME,
  loginWithPassword,
  requestPasswordReset,
  resetPasswordWithToken,
  signSessionCookie,
} from '../services/auth.service.js';
import { env } from '../lib/env.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(16),
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

  app.post('/auth/forgot-password', async (req: Request, res: Response) => {
    try {
      const body = forgotSchema.parse(req.body);
      const result = await requestPasswordReset(body.email);
      res.json({ success: true, message: result.message });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Informe um e-mail válido' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Erro ao solicitar redefinição';
      res.status(400).json({ error: message });
    }
  });

  app.post('/auth/reset-password', async (req: Request, res: Response) => {
    try {
      const body = resetSchema.parse(req.body);
      await resetPasswordWithToken(body.token, body.password);
      res.json({ success: true, message: 'Senha atualizada com sucesso' });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Token e senha (mín. 8 caracteres) são obrigatórios' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Erro ao redefinir senha';
      res.status(400).json({ error: message });
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
