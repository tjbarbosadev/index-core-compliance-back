import { timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import { env } from '../lib/env.js';
import {
  applyZapSignDocumentState,
  type ZapSignEvent,
} from '../services/cedente-onboarding.service.js';

const HANDLED_EVENTS = new Set(['doc_signed', 'doc_refused']);

export function isValidWebhookSecret(provided: string | undefined, expected: string | undefined) {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function secretFrom(req: Request): string | undefined {
  const header = req.header('x-webhook-secret');
  if (header) return header;
  const query = req.query.secret;
  return typeof query === 'string' ? query : undefined;
}

export function registerZapSignWebhookRoutes(app: Express) {
  app.post('/webhooks/zapsign', async (req, res) => {
    if (!env.zapsignWebhookSecret) {
      res.status(503).json({ error: 'Webhook ZapSign não configurado' });
      return;
    }
    if (!isValidWebhookSecret(secretFrom(req), env.zapsignWebhookSecret)) {
      res.status(401).json({ error: 'Assinatura do webhook inválida' });
      return;
    }

    const event = (req.body ?? {}) as ZapSignEvent;
    if (!event.event_type || !HANDLED_EVENTS.has(event.event_type)) {
      res.status(200).json({ ignored: true });
      return;
    }

    try {
      const result = await applyZapSignDocumentState({
        ...event,
        status: event.event_type === 'doc_refused' ? 'refused' : event.status,
      });
      res.status(200).json(result);
    } catch (err) {
      console.error('[zapsign] webhook falhou', err);
      res.status(500).json({ error: 'Falha ao processar webhook' });
    }
  });
}
