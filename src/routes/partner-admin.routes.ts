import type { Express, Request, Response } from 'express';
import {
  createApiPartner,
  rotatePartnerToken,
  revokePartner,
  listPartnerRequests,
} from '../services/partner.service.js';
import { prisma } from '../db/index.js';
import { verifySessionCookie, getUserFromSession, COOKIE_NAME } from '../services/auth.service.js';
import { resolveUserPermissions } from '../services/permission.service.js';

async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const cookie = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!cookie) {
    res.status(401).json({ error: 'Não autenticado' });
    return false;
  }
  const payload = verifySessionCookie(cookie);
  if (!payload) {
    res.status(401).json({ error: 'Sessão inválida' });
    return false;
  }
  const user = await getUserFromSession(payload.sessionId, payload.userId);
  if (!user) {
    res.status(401).json({ error: 'Sessão inválida' });
    return false;
  }
  const perms = await resolveUserPermissions(user.id);
  if (!user.isAdmin && !perms.includes('admin.manage_access')) {
    res.status(403).json({ error: 'Permissão ausente' });
    return false;
  }
  return true;
}

/** Rotas admin para gerenciar parceiros externos (cookie admin). */
export function registerPartnerAdminRoutes(app: Express) {
  app.get('/admin/partners', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const rows = await prisma.apiPartner.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        rateLimitRpm: true,
        rotatedAt: true,
        previousTokenValidUntil: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ partners: rows });
  });

  app.post('/admin/partners', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim();
    const rateLimitRpm = Number(req.body?.rateLimitRpm ?? 120);
    if (!name) {
      res.status(400).json({ error: 'name obrigatório' });
      return;
    }
    if (!email) {
      res.status(400).json({ error: 'email obrigatório' });
      return;
    }
    try {
      const result = await createApiPartner({ name, email, rateLimitRpm });
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      res.status(400).json({ error: message });
    }
  });

  app.get('/admin/partners/:id/requests', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const partner = await prisma.apiPartner.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!partner) {
      res.status(404).json({ error: 'Parceiro não encontrado' });
      return;
    }
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    try {
      const result = await listPartnerRequests(partner.id, { limit, cursor });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      res.status(400).json({ error: message });
    }
  });

  app.post('/admin/partners/:id/rotate', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      const result = await rotatePartnerToken(req.params.id);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      res.status(400).json({ error: message });
    }
  });

  app.post('/admin/partners/:id/revoke', async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    try {
      await revokePartner(req.params.id);
      res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro';
      res.status(400).json({ error: message });
    }
  });
}
