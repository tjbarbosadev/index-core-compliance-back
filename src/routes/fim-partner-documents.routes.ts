import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  FIM_SCOPE_DOCUMENTS_READ,
  FIM_SCOPE_DOCUMENTS_WRITE,
  type AuthenticatedPartner,
} from '../services/partner.service.js';
import {
  deletePartnerDocument,
  downloadPartnerDocument,
  listPartnerDocuments,
  PARTNER_DOCUMENT_MAX_BYTES,
  PartnerDocumentsError,
  uploadPartnerDocument,
} from '../services/partner-documents.service.js';
import { MegaError } from '../lib/mega/client.js';

type PartnerRequest = Request & { partner?: AuthenticatedPartner };

type Guards = {
  requirePartner: (req: PartnerRequest, res: Response, next: NextFunction) => Promise<void> | void;
  logPartnerAccess: (req: PartnerRequest, res: Response, next: NextFunction) => void;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PARTNER_DOCUMENT_MAX_BYTES, files: 1 },
});

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  return req.ip ?? null;
}

function requireScope(scope: string) {
  return (req: PartnerRequest, res: Response, next: NextFunction) => {
    if (!req.partner?.scopes.includes(scope)) {
      res.status(403).json({ error: 'Escopo ausente' });
      return;
    }
    next();
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof PartnerDocumentsError || err instanceof MegaError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[fim-partner-documents] unexpected error', err);
  res.status(500).json({ error: 'Erro interno' });
}

function contentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede o limite de 12 MB' : err.message;
      res.status(400).json({ error: message });
      return;
    }
    sendError(res, err);
  });
}

export function registerFimPartnerDocumentRoutes(app: Express, guards: Guards) {
  const { requirePartner, logPartnerAccess } = guards;

  app.post(
    '/v1/fim/shareholders/:document/documents',
    requirePartner,
    logPartnerAccess,
    requireScope(FIM_SCOPE_DOCUMENTS_WRITE),
    handleUpload,
    async (req: PartnerRequest, res: Response) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Arquivo obrigatório (campo "file")' });
        return;
      }
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await uploadPartnerDocument({
          partner: { id: req.partner!.id, name: req.partner!.name },
          document: req.params.document,
          cotistaId: optionalString(body.cotistaId),
          name: optionalString(body.name),
          label: optionalString(body.label),
          file: {
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          },
          ip: clientIp(req),
        });
        res.status(result.status).json(result.body);
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.get(
    '/v1/fim/shareholders/:document/documents',
    requirePartner,
    logPartnerAccess,
    requireScope(FIM_SCOPE_DOCUMENTS_READ),
    async (req: PartnerRequest, res: Response) => {
      try {
        const result = await listPartnerDocuments({
          partner: { id: req.partner!.id },
          document: req.params.document,
          cotistaId: optionalString(req.query.cotistaId),
          ip: clientIp(req),
        });
        res.status(200).json(result);
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.get(
    '/v1/fim/shareholders/:document/documents/:fileId',
    requirePartner,
    logPartnerAccess,
    requireScope(FIM_SCOPE_DOCUMENTS_READ),
    async (req: PartnerRequest, res: Response) => {
      const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
      try {
        const result = await downloadPartnerDocument({
          partner: { id: req.partner!.id },
          document: req.params.document,
          fileId: req.params.fileId,
          cotistaId: optionalString(req.query.cotistaId),
          ip: clientIp(req),
        });
        res.status(200);
        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Length', String(result.buffer.length));
        res.setHeader('Content-Disposition', contentDisposition(disposition, result.originalName));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(result.buffer);
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.delete(
    '/v1/fim/shareholders/:document/documents/:fileId',
    requirePartner,
    logPartnerAccess,
    requireScope(FIM_SCOPE_DOCUMENTS_WRITE),
    async (req: PartnerRequest, res: Response) => {
      try {
        const result = await deletePartnerDocument({
          partner: { id: req.partner!.id },
          document: req.params.document,
          fileId: req.params.fileId,
          cotistaId: optionalString(req.query.cotistaId),
          ip: clientIp(req),
        });
        res.status(200).json(result);
      } catch (err) {
        sendError(res, err);
      }
    },
  );
}
