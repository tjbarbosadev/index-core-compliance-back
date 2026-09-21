import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc/procedures.js';
import { env } from '../lib/env.js';
import {
  ensureAlertSession,
  getSessionQr,
  getSessionStatus,
  isOpenWaConfigured,
  logoutSession,
  maskPhone,
  parseWhatsappDestinations,
  sendWhatsappMessage,
  type OpenWaSessionInfo,
} from '../services/whatsapp.service.js';

function openWaEnv() {
  return {
    baseUrl: env.openWaBaseUrl,
    apiKey: env.openWaApiKey,
    sessionId: env.openWaSessionId,
    sessionName: env.openWaSessionName,
  };
}

function sessionPayload(session: OpenWaSessionInfo | null) {
  if (!session) return null;
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    phone: session.phone ? maskPhone(session.phone) : null,
  };
}

export const whatsappAlertsRouter = router({
  status: adminProcedure.query(async () => {
    const cfg = openWaEnv();
    const configured = isOpenWaConfigured(cfg);
    const destinations = parseWhatsappDestinations(env.amortizationAlertWhatsappTo).map(maskPhone);
    if (!configured) {
      return {
        configured: false,
        sessionName: cfg.sessionName ?? 'opcore-alerts',
        session: null,
        destinations,
      };
    }
    const session = await getSessionStatus(cfg);
    return {
      configured: true,
      sessionName: cfg.sessionName ?? 'opcore-alerts',
      session: sessionPayload(session),
      destinations,
    };
  }),

  start: adminProcedure.mutation(async () => {
    const cfg = openWaEnv();
    if (!isOpenWaConfigured(cfg)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'OpenWA não configurado (OPENWA_BASE_URL / OPENWA_API_KEY)',
      });
    }
    const session = await ensureAlertSession(cfg);
    if (!session) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Não foi possível criar/iniciar a sessão OpenWA',
      });
    }
    return { session: sessionPayload(session) };
  }),

  qr: adminProcedure.query(async () => {
    const cfg = openWaEnv();
    if (!isOpenWaConfigured(cfg)) {
      return { qr: null as string | null };
    }
    const session = await getSessionStatus(cfg);
    if (!session || (session.status !== 'qr_ready' && session.status !== 'initializing')) {
      return { qr: null as string | null };
    }
    const qr = await getSessionQr({ ...cfg, sessionId: session.id });
    return { qr };
  }),

  sendTest: adminProcedure
    .input(
      z
        .object({
          text: z.string().min(1).max(1000).optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const cfg = openWaEnv();
      if (!isOpenWaConfigured(cfg)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'OpenWA não configurado',
        });
      }
      const session = await getSessionStatus(cfg);
      if (!session?.id || session.status !== 'ready') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Sessão WhatsApp não está conectada (status ready)',
        });
      }
      const destinations = parseWhatsappDestinations(env.amortizationAlertWhatsappTo);
      if (destinations.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AMORTIZATION_ALERT_WHATSAPP_TO vazio',
        });
      }
      const text = input?.text?.trim() || 'teste lembrete cotistas';
      const results: Array<{ to: string; sent: boolean; reason: string }> = [];
      for (const to of destinations) {
        const r = await sendWhatsappMessage({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          sessionId: session.id,
          to,
          text,
        });
        results.push({ to: maskPhone(to), sent: r.sent, reason: r.reason });
      }
      return { results };
    }),

  disconnect: adminProcedure.mutation(async () => {
    const cfg = openWaEnv();
    if (!isOpenWaConfigured(cfg)) {
      return { ok: false };
    }
    const ok = await logoutSession(cfg);
    return { ok };
  }),
});
