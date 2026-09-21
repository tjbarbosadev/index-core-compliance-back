import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpc/procedures.js';
import { env } from '../lib/env.js';
import {
  isOpenWaConfigured,
  maskPhone,
  parseWhatsappDestinations,
  sendWhatsappMessage,
} from '../services/whatsapp.service.js';
import {
  disconnectUserWhatsapp,
  getUserWhatsappQr,
  getUserWhatsappStatus,
  listReadyWhatsappPhones,
  startUserWhatsappSession,
} from '../services/whatsapp-session.service.js';

function sessionPayload(
  session: {
    id: string;
    name: string | null;
    status: string | null;
    phone: string | null;
  } | null,
) {
  if (!session) return null;
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    phone: session.phone ? maskPhone(session.phone) : null,
  };
}

export const whatsappAlertsRouter = router({
  status: adminProcedure.query(async ({ ctx }) => {
    const configured = isOpenWaConfigured({
      baseUrl: env.openWaBaseUrl,
      apiKey: env.openWaApiKey,
    });
    const userStatus = await getUserWhatsappStatus(ctx.user.id);
    const readyPhones = await listReadyWhatsappPhones();
    const envDestinations = parseWhatsappDestinations(env.amortizationAlertWhatsappTo);
    const destinations = [...new Set([...readyPhones, ...envDestinations])].map(maskPhone);

    return {
      configured,
      sessionName: userStatus.sessionName,
      session: sessionPayload(userStatus.session),
      destinations,
      optIn: userStatus.session?.status === 'ready',
    };
  }),

  start: adminProcedure.mutation(async ({ ctx }) => {
    if (
      !isOpenWaConfigured({
        baseUrl: env.openWaBaseUrl,
        apiKey: env.openWaApiKey,
      })
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'OpenWA não configurado (OPENWA_BASE_URL / OPENWA_API_KEY)',
      });
    }
    const session = await startUserWhatsappSession(ctx.user.id);
    if (!session) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Não foi possível criar/iniciar a sessão OpenWA',
      });
    }
    return { session: sessionPayload(session) };
  }),

  qr: adminProcedure.query(async ({ ctx }) => {
    if (
      !isOpenWaConfigured({
        baseUrl: env.openWaBaseUrl,
        apiKey: env.openWaApiKey,
      })
    ) {
      return { qr: null as string | null };
    }
    const userStatus = await getUserWhatsappStatus(ctx.user.id);
    const st = userStatus.session?.status;
    if (!st || (st !== 'qr_ready' && st !== 'initializing')) {
      return { qr: null as string | null };
    }
    const qr = await getUserWhatsappQr(ctx.user.id);
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
    .mutation(async ({ ctx, input }) => {
      if (
        !isOpenWaConfigured({
          baseUrl: env.openWaBaseUrl,
          apiKey: env.openWaApiKey,
        })
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'OpenWA não configurado',
        });
      }
      const userStatus = await getUserWhatsappStatus(ctx.user.id);
      if (!userStatus.session?.id || userStatus.session.status !== 'ready') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Sessão WhatsApp não está conectada (status ready)',
        });
      }
      const ownPhone = userStatus.phoneNormalized;
      if (!ownPhone) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Telefone da sessão ainda não disponível',
        });
      }
      const text = input?.text?.trim() || 'teste lembrete cotistas';
      const r = await sendWhatsappMessage({
        baseUrl: env.openWaBaseUrl,
        apiKey: env.openWaApiKey,
        sessionId: userStatus.session.id,
        to: ownPhone,
        text,
      });
      return {
        results: [{ to: maskPhone(ownPhone), sent: r.sent, reason: r.reason }],
      };
    }),

  disconnect: adminProcedure.mutation(async ({ ctx }) => {
    const ok = await disconnectUserWhatsapp(ctx.user.id);
    return { ok };
  }),
});
