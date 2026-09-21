import { prisma } from '../db/index.js';
import { env } from '../lib/env.js';
import {
  ensureAlertSession,
  getSessionQr,
  getSessionStatus,
  isOpenWaConfigured,
  logoutSession,
  normalizeBrazilWaPhone,
  type OpenWaConfigInput,
  type OpenWaSessionInfo,
} from './whatsapp.service.js';

export function openWaUserSessionName(userId: string): string {
  return `opcore-user-${userId}`;
}

function openWaEnv(overrides?: Partial<OpenWaConfigInput>): OpenWaConfigInput {
  return {
    baseUrl: env.openWaBaseUrl,
    apiKey: env.openWaApiKey,
    sessionId: overrides?.sessionId ?? undefined,
    sessionName: overrides?.sessionName ?? undefined,
    fetchImpl: overrides?.fetchImpl,
  };
}

export async function getUserWhatsappRow(userId: string) {
  return prisma.whatsappSession.findUnique({ where: { userId } });
}

/** Phones of ready sessions — opt-in recipients for amortization alerts. */
export async function listReadyWhatsappPhones(): Promise<string[]> {
  const rows = await prisma.whatsappSession.findMany({
    where: { status: 'ready', phoneNormalized: { not: null } },
    select: { phoneNormalized: true },
    orderBy: { connectedAt: 'asc' },
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const phone = row.phoneNormalized?.trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

/** First ready OpenWA session id (by connectedAt), for sending. */
export async function resolveSenderOpenWaSessionId(): Promise<string | null> {
  const explicit = env.openWaSessionId?.trim();
  if (explicit) return explicit;

  const row = await prisma.whatsappSession.findFirst({
    where: { status: 'ready', openwaSessionId: { not: null } },
    orderBy: { connectedAt: 'asc' },
    select: { openwaSessionId: true },
  });
  return row?.openwaSessionId?.trim() || null;
}

async function syncRowFromRemote(
  userId: string,
  remote: OpenWaSessionInfo | null,
): Promise<{
  openwaSessionId: string | null;
  status: string;
  phone: string | null;
  phoneNormalized: string | null;
}> {
  const phoneRaw = remote?.phone ?? null;
  const phoneNormalized = phoneRaw ? normalizeBrazilWaPhone(phoneRaw) : null;
  const status = remote?.status?.trim() || 'pending';
  const openwaSessionId = remote?.id || null;
  const connectedAt = status === 'ready' ? new Date() : null;

  const data = {
    openwaSessionId,
    status,
    phone: phoneRaw,
    phoneNormalized,
    ...(status === 'ready' ? { connectedAt } : {}),
  };

  await prisma.whatsappSession.upsert({
    where: { userId },
    create: {
      userId,
      ...data,
      connectedAt: status === 'ready' ? new Date() : null,
    },
    update: {
      ...data,
      ...(status === 'ready'
        ? { connectedAt: new Date() }
        : status === 'disconnected'
          ? { connectedAt: null }
          : {}),
    },
  });

  return {
    openwaSessionId,
    status,
    phone: phoneRaw,
    phoneNormalized,
  };
}

export async function getUserWhatsappStatus(userId: string): Promise<{
  configured: boolean;
  sessionName: string;
  session: OpenWaSessionInfo | null;
  phoneNormalized: string | null;
}> {
  const sessionName = openWaUserSessionName(userId);
  const cfg = openWaEnv();
  const configured = isOpenWaConfigured(cfg);
  const row = await getUserWhatsappRow(userId);

  if (!configured) {
    return {
      configured: false,
      sessionName,
      session: row
        ? {
            id: row.openwaSessionId || '',
            name: sessionName,
            status: row.status,
            phone: row.phone,
          }
        : null,
      phoneNormalized: row?.phoneNormalized ?? null,
    };
  }

  let remote: OpenWaSessionInfo | null = null;
  if (row?.openwaSessionId) {
    remote = await getSessionStatus({ ...cfg, sessionId: row.openwaSessionId });
  }

  if (remote) {
    const synced = await syncRowFromRemote(userId, remote);
    return {
      configured: true,
      sessionName,
      session: {
        id: synced.openwaSessionId || remote.id,
        name: sessionName,
        status: synced.status,
        phone: synced.phone,
      },
      phoneNormalized: synced.phoneNormalized,
    };
  }

  return {
    configured: true,
    sessionName,
    session: row
      ? {
          id: row.openwaSessionId || '',
          name: sessionName,
          status: row.status,
          phone: row.phone,
        }
      : null,
    phoneNormalized: row?.phoneNormalized ?? null,
  };
}

export async function startUserWhatsappSession(userId: string): Promise<OpenWaSessionInfo | null> {
  const sessionName = openWaUserSessionName(userId);
  const cfg = openWaEnv();
  if (!isOpenWaConfigured(cfg)) return null;

  const row = await getUserWhatsappRow(userId);
  const remote = await ensureAlertSession({
    ...cfg,
    sessionId: row?.openwaSessionId,
    sessionName,
  });
  if (!remote) return null;

  await syncRowFromRemote(userId, remote);
  return remote;
}

export async function getUserWhatsappQr(userId: string): Promise<string | null> {
  const cfg = openWaEnv();
  if (!isOpenWaConfigured(cfg)) return null;
  const row = await getUserWhatsappRow(userId);
  if (!row?.openwaSessionId) return null;
  return getSessionQr({ ...cfg, sessionId: row.openwaSessionId });
}

export async function disconnectUserWhatsapp(userId: string): Promise<boolean> {
  const cfg = openWaEnv();
  const row = await getUserWhatsappRow(userId);
  if (!row?.openwaSessionId) {
    if (row) {
      await prisma.whatsappSession.update({
        where: { userId },
        data: {
          status: 'disconnected',
          openwaSessionId: null,
          phone: null,
          phoneNormalized: null,
          connectedAt: null,
        },
      });
    }
    return true;
  }

  let ok = true;
  if (isOpenWaConfigured(cfg)) {
    ok = await logoutSession({ ...cfg, sessionId: row.openwaSessionId });
  }

  await prisma.whatsappSession.update({
    where: { userId },
    data: {
      status: 'disconnected',
      openwaSessionId: null,
      phone: null,
      phoneNormalized: null,
      connectedAt: null,
    },
  });
  return ok;
}
