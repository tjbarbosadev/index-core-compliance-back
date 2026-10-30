import type { Express, NextFunction, Request, Response } from 'express';
import {
  FIM_SCOPE_SHAREHOLDERS_READ,
  FIM_SCOPE_SUBSCRIPTIONS_WRITE,
  type AuthenticatedPartner,
} from '../services/partner.service.js';
import {
  FimPartnerError,
  getFimShareholder,
  getFimShareholderYields,
  parseFimSubscription,
  subscribeFim,
} from '../services/fim-subscription.service.js';

type PartnerRequest = Request & { partner?: AuthenticatedPartner };

type Guards = {
  requirePartner: (req: PartnerRequest, res: Response, next: NextFunction) => Promise<void> | void;
  logPartnerAccess: (req: PartnerRequest, res: Response, next: NextFunction) => void;
};

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

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function registerFimPartnerRoutes(app: Express, guards: Guards) {
  const { requirePartner, logPartnerAccess } = guards;

  app.post(
    '/v1/fim/subscriptions',
    requirePartner,
    logPartnerAccess,
    requireScope(FIM_SCOPE_SUBSCRIPTIONS_WRITE),
    async (req: PartnerRequest, res: Response) => {
      const parsed = parseFimSubscription(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.message });
        return;
      }
      try {
        const result = await subscribeFim({
          partner: { id: req.partner!.id, name: req.partner!.name },
          body: parsed.input,
          ip: clientIp(req),
        });
        res.status(200).json(result);
      } catch (err) {
        if (err instanceof FimPartnerError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        console.error('[v1/fim/subscriptions]', err);
        res.status(500).json({ error: 'Erro ao registrar aplicação' });
      }
    },
  );

  app.get(
    '/v1/fim/shareholders/:document/yields',
    requirePartner,
    logPartnerAccess,
    requireScope(FIM_SCOPE_SHAREHOLDERS_READ),
    async (req: PartnerRequest, res: Response) => {
      try {
        const result = await getFimShareholderYields(req.params.document, {
          days: queryString(req.query.days),
          from: queryString(req.query.from),
          to: queryString(req.query.to),
        });
        res.json(result);
      } catch (err) {
        if (err instanceof FimPartnerError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        console.error('[v1/fim/shareholders/yields]', err);
        res.status(500).json({ error: 'Erro ao listar rendimentos' });
      }
    },
  );

  app.get(
    '/v1/fim/shareholders/:document',
    requirePartner,
    logPartnerAccess,
    requireScope(FIM_SCOPE_SHAREHOLDERS_READ),
    async (req: PartnerRequest, res: Response) => {
      try {
        const result = await getFimShareholder(req.params.document);
        res.json(result);
      } catch (err) {
        if (err instanceof FimPartnerError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        console.error('[v1/fim/shareholders]', err);
        res.status(500).json({ error: 'Erro ao obter posição' });
      }
    },
  );
}
