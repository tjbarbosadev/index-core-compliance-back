import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { ingestSiteProposal } from '../services/onboarding.service.js';

function requireProposalIngestKey(req: Request, res: Response, next: NextFunction) {
  if (!env.proposalIngestServiceKey) {
    res
      .status(503)
      .json({ error: 'Ingest de propostas não configurado (PROPOSAL_INGEST_SERVICE_KEY)' });
    return;
  }
  const key = req.headers['x-api-key'];
  const provided = typeof key === 'string' ? key : Array.isArray(key) ? key[0] : '';
  if (!provided || provided !== env.proposalIngestServiceKey) {
    res.status(401).json({ error: 'API key inválida' });
    return;
  }
  next();
}

const proposalBodySchema = z.object({
  source: z.enum(['nexafidic', 'nextcorefim']),
  partyType: z.enum(['pf', 'pj']),
  cpfCnpj: z.string().min(11),
  legalName: z.string().min(1).max(500),
  email: z
    .string()
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t && t.includes('@') ? t : undefined;
    }),
  phone: z.string().max(30).optional(),
  fundCnpj: z.string().min(14),
  quotaType: z
    .enum(['senior', 'senior_i', 'senior_ii', 'mezanino', 'subordinada', 'unica'])
    .optional(),
  externalApplicationId: z.string().min(1).max(36).optional(),
  payload: z.record(z.unknown()).optional(),
  suitability: z.record(z.unknown()).optional(),
});

export function registerInternalRoutes(app: Express) {
  app.post('/internal/proposals', requireProposalIngestKey, async (req, res) => {
    try {
      const parsed = proposalBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues.map((i) => i.message).join(', ') || 'Payload inválido',
        });
        return;
      }

      const result = await ingestSiteProposal(parsed.data);
      res.status(result.created ? 201 : 200).json({
        success: true,
        created: result.created,
        id: result.process?.id,
        process: result.process,
      });
    } catch (err) {
      const trpc = err as { code?: string; message?: string };
      if (trpc.code === 'NOT_FOUND') {
        res.status(404).json({ error: trpc.message ?? 'Não encontrado' });
        return;
      }
      if (trpc.code === 'CONFLICT') {
        res.status(409).json({ error: trpc.message ?? 'Conflito' });
        return;
      }
      if (trpc.code === 'BAD_REQUEST') {
        res.status(400).json({ error: trpc.message ?? 'Requisição inválida' });
        return;
      }
      console.error('[internal/proposals]', err);
      res.status(500).json({ error: 'Erro interno ao ingerir proposta' });
    }
  });
}
