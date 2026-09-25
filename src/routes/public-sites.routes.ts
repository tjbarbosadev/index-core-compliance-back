import type { Express, NextFunction, Request, Response } from 'express';
import { env } from '../lib/env.js';
import {
  NEXAFIDIC_FUND_CNPJ,
  normalizeNexafidicPayload,
  summarizeNexafidicPayload,
} from '../lib/nexafidic-normalize.js';
import { ingestSiteProposal } from '../services/onboarding.service.js';
import { sendSiteProposalEmail } from '../services/email.service.js';

const RATE_LIMIT_PER_MINUTE = 5;
const rateBuckets = new Map<string, number[]>();

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return req.ip ?? 'unknown';
}

function checkRateLimit(key: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const hits = (rateBuckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= RATE_LIMIT_PER_MINUTE) {
    rateBuckets.set(key, hits);
    const retryAfterSec = Math.max(1, Math.ceil((hits[0]! + windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return { ok: true, retryAfterSec: 0 };
}

/** Test helper */
export function _clearPublicSiteRateBucketsForTests() {
  rateBuckets.clear();
}

/** Formulário estático não guarda segredo: exige Origin da allowlist (o CORS sozinho não bloqueia o POST). */
function requireAllowedOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (!origin || !env.corsOrigins.includes(origin)) {
    res.status(403).json({ success: false, message: 'Origem não autorizada' });
    return;
  }
  next();
}

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const limit = checkRateLimit(`nexafidic:${clientIp(req)}`);
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    res.status(429).json({
      success: false,
      message: 'Muitas tentativas. Aguarde um minuto e tente novamente.',
    });
    return;
  }
  next();
}

export function registerPublicSitesRoutes(app: Express) {
  app.post(
    '/public/sites/nexafidic/proposals',
    requireAllowedOrigin,
    rateLimit,
    async (req, res) => {
      const body = req.body as unknown;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        res.status(400).json({ success: false, message: 'Payload inválido' });
        return;
      }

      const normalized = normalizeNexafidicPayload(body as Record<string, unknown>);
      const summary = summarizeNexafidicPayload(normalized);
      const expectedLength = summary.partyType === 'pj' ? 14 : 11;
      if (summary.cpfCnpj.length !== expectedLength) {
        res.status(400).json({
          success: false,
          message: summary.partyType === 'pj' ? 'CNPJ inválido' : 'CPF inválido',
        });
        return;
      }
      if (!summary.legalName) {
        res.status(400).json({
          success: false,
          message: summary.partyType === 'pj' ? 'Razão social obrigatória' : 'Nome obrigatório',
        });
        return;
      }

      let result: Awaited<ReturnType<typeof ingestSiteProposal>>;
      try {
        result = await ingestSiteProposal({
          source: 'nexafidic',
          partyType: summary.partyType,
          cpfCnpj: summary.cpfCnpj,
          legalName: summary.legalName.slice(0, 500),
          email: summary.email,
          phone: summary.phone,
          fundCnpj: NEXAFIDIC_FUND_CNPJ,
          quotaType: 'senior_i',
          payload: normalized,
        });
      } catch (err) {
        const trpc = err as { code?: string; message?: string };
        if (trpc.code === 'CONFLICT') {
          res.status(409).json({
            success: false,
            message: 'Já existe um cadastro concluído para este documento. Fale com a equipe.',
          });
          return;
        }
        if (trpc.code === 'BAD_REQUEST' || trpc.code === 'NOT_FOUND') {
          res.status(400).json({ success: false, message: trpc.message ?? 'Requisição inválida' });
          return;
        }
        console.error('[public/sites/nexafidic]', err);
        res.status(500).json({ success: false, message: 'Erro ao registrar a proposta' });
        return;
      }

      const id = result.process?.id;
      try {
        await sendSiteProposalEmail({
          recipients: env.siteProposalNotifyEmails,
          siteLabel: 'Site FIDC',
          partyType: summary.partyType,
          legalName: summary.legalName,
          cpfCnpj: summary.cpfCnpj,
          email: summary.email,
          phone: summary.phone,
          onboardingUrl: `${env.webUrl}/onboarding/${id ?? ''}`,
          created: result.created,
        });
      } catch (err) {
        console.error('[public/sites/nexafidic] aviso por e-mail falhou', err);
      }

      res.status(result.created ? 201 : 200).json({ success: true, id });
    },
  );
}
