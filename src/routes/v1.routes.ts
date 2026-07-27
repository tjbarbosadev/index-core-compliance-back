import type { Request, Response, NextFunction, Express } from 'express';
import {
  authenticatePartnerBearer,
  checkPartnerRateLimit,
  logPartnerRequest,
  type AuthenticatedPartner,
} from '../services/partner.service.js';
import * as cotistaService from '../services/cotista.service.js';
import { getVisualizationDate, toYYYYMMDD } from '../services/quota-calculator.js';

type PartnerRequest = Request & { partner?: AuthenticatedPartner };

function mapQuotaToLegacy(quotaType: string | null | undefined): string | null {
  if (quotaType === 'senior_i') return 'sri';
  if (quotaType === 'senior_ii') return 'srii';
  return quotaType ?? null;
}

function toPublicCotista(full: Awaited<ReturnType<typeof cotistaService.mapCotistaFull>>) {
  return {
    id: full.id,
    name: full.legalName,
    document: full.cpfCnpj,
    email: full.email ?? null,
    phone: full.phone ?? null,
    investment: full.initialInvestment ?? 0,
    totalQuotas: full.quotaCount ?? 0,
    initialDate: full.contractStartDate,
    finalDate: full.contractEndDate,
    quota: mapQuotaToLegacy(full.quotaType),
    quotaTypeLabel: full.quotaTypeLabel,
    status: full.status,
    fundId: full.fundId,
    fundName: full.fundName,
    visualizationDate: full.visualizationDate,
    latestYield: full.latestYield,
  };
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  return req.ip ?? null;
}

async function requirePartner(req: PartnerRequest, res: Response, next: NextFunction) {
  const partner = await authenticatePartnerBearer(req.headers.authorization);
  if (!partner) {
    res.status(401).json({ error: 'Token inválido ou ausente' });
    return;
  }

  const limit = checkPartnerRateLimit(partner.id, partner.rateLimitRpm);
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    res.status(429).json({ error: 'Rate limit excedido', retryAfterSec: limit.retryAfterSec });
    return;
  }

  req.partner = partner;
  next();
}

function logPartnerAccess(req: PartnerRequest, res: Response, next: NextFunction) {
  const partnerId = req.partner?.id;
  if (!partnerId) {
    next();
    return;
  }

  const method = req.method;
  const path = (req.originalUrl || req.url || '').slice(0, 512);
  const ip = clientIp(req);
  const userAgent =
    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

  res.on('finish', () => {
    void logPartnerRequest({
      partnerId,
      method,
      path,
      statusCode: res.statusCode,
      ip,
      userAgent,
    });
  });

  next();
}

export function registerV1Routes(app: Express) {
  app.get('/v1/cotistas', requirePartner, logPartnerAccess, async (_req, res) => {
    try {
      const list = await cotistaService.listCotistas(['cotistas.view_kyc'], true);
      const items = await Promise.all(
        list.map(async (c) => {
          if (!('riskLevel' in c)) return null;
          const full = await cotistaService.mapCotistaFull(c.id);
          return toPublicCotista(full);
        }),
      );
      res.json({
        visualizationDate: toYYYYMMDD(getVisualizationDate()),
        clients: items.filter(Boolean),
      });
    } catch (err) {
      console.error('[v1/cotistas]', err);
      res.status(500).json({ error: 'Erro ao listar cotistas' });
    }
  });

  app.get('/v1/cotistas/:id', requirePartner, logPartnerAccess, async (req, res) => {
    try {
      const full = await cotistaService.mapCotistaFull(req.params.id);
      res.json(toPublicCotista(full));
    } catch (err) {
      console.error('[v1/cotistas/:id]', err);
      res.status(404).json({ error: 'Cotista não encontrado' });
    }
  });

  app.get('/v1/cotistas/:id/yields', requirePartner, logPartnerAccess, async (req, res) => {
    try {
      const result = await cotistaService.getCotistaYields(req.params.id, {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 90,
      });
      res.json(result);
    } catch (err) {
      console.error('[v1/cotistas/:id/yields]', err);
      res.status(500).json({ error: 'Erro ao listar rendimentos' });
    }
  });

  app.get('/v1/cotistas/:id/amortizations', requirePartner, logPartnerAccess, async (req, res) => {
    try {
      const items = await cotistaService.getCotistaAmortizations(req.params.id);
      res.json({ items });
    } catch (err) {
      console.error('[v1/cotistas/:id/amortizations]', err);
      res.status(500).json({ error: 'Erro ao listar amortizações' });
    }
  });
}
