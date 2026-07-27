import type { Express, Request, Response } from 'express';
import express from 'express';
import { prisma } from '../db/index.js';
import { COOKIE_NAME, getUserFromSession, verifySessionCookie } from '../services/auth.service.js';
import { hasPermissionInList, resolveUserPermissions } from '../services/permission.service.js';
import { keyFromFileUri, saveFile } from '../lib/storage.js';

async function requireDocumentsWrite(req: Request, res: Response) {
  const cookie = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!cookie) {
    res.status(401).json({ error: 'Não autenticado' });
    return null;
  }

  const payload = verifySessionCookie(cookie);
  if (!payload) {
    res.status(401).json({ error: 'Sessão inválida' });
    return null;
  }

  const user = await getUserFromSession(payload.sessionId, payload.userId);
  if (!user) {
    res.status(401).json({ error: 'Sessão inválida' });
    return null;
  }

  const permissions = await resolveUserPermissions(user.id);
  if (!hasPermissionInList(permissions, 'documents.write', user.isAdmin)) {
    res.status(403).json({ error: 'Permissão ausente' });
    return null;
  }

  return user;
}

export function registerFilesRoutes(app: Express) {
  app.put(
    '/files/upload/:documentId',
    express.raw({ type: '*/*', limit: '50mb' }),
    async (req, res) => {
      if (!(await requireDocumentsWrite(req, res))) return;

      const documentId = req.params.documentId;
      if (!documentId) {
        res.status(400).json({ error: 'Documento inválido' });
        return;
      }

      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      if (!doc) {
        res.status(404).json({ error: 'Documento não encontrado' });
        return;
      }

      if (doc.status !== 'pendente') {
        res.status(400).json({ error: 'Documento não está pendente de upload' });
        return;
      }

      if (!doc.fileUri) {
        res.status(400).json({ error: 'Documento sem destino de armazenamento' });
        return;
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Arquivo vazio' });
        return;
      }

      try {
        const key = keyFromFileUri(doc.fileUri);
        await saveFile(key, body);
        await prisma.document.update({
          where: { id: documentId },
          data: { sizeBytes: body.length },
        });
        res.status(204).end();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Falha ao salvar arquivo';
        res.status(400).json({ error: message });
      }
    },
  );
}
