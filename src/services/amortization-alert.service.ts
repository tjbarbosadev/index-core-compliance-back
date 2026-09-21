import { Prisma } from '@prisma/client';
import { env } from '../lib/env.js';
import { prisma } from '../db/index.js';
import {
  isSeniorIAmortizationDay,
  parseYYYYMMDD,
  toYYYYMMDD,
  tomorrowYYYYMMDD,
} from './quota-calculator.js';
import { sendTelegramMessage, type SendTelegramResult } from './telegram.service.js';
import {
  hasOpenWaDestination,
  parseWhatsappDestinations,
  resolveOpenWaSessionId,
  sendWhatsappMessage,
  type SendWhatsappResult,
} from './whatsapp.service.js';

const SENIOR_I_QUOTA_TYPES = new Set(['senior_i', 'senior']);
const MAX_LIST_LINES = 15;

export type AmortizationAlertLink = {
  id: string;
  quotaType: string;
  contractStartDate: Date | null;
  contractEndDate: Date | null;
  party: { legalName: string };
  fund: { name: string };
};

export type AmortizationAlertChannelResult = {
  channel: 'telegram' | 'whatsapp';
  destination: string;
  reason: 'skipped' | 'already_sent' | 'error' | 'sent' | 'ok';
};

export type AmortizationAlertJobResult = {
  targetDate: string;
  count: number;
  skipped?: boolean;
  reason?:
    | 'disabled'
    | 'telegram_skipped'
    | 'ok'
    | 'already_sent'
    | 'telegram_error'
    | 'whatsapp_skipped'
    | 'whatsapp_error';
  channels?: AmortizationAlertChannelResult[];
};

export function hasTelegramDestination(token?: string | null, chatId?: string | null): boolean {
  return Boolean(token?.trim() && chatId?.trim());
}

/** Formata YYYY-MM-DD → DD/MM/YYYY. */
export function formatDatePtBr(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-');
  if (!y || !m || !d) return yyyyMmDd;
  return `${d}/${m}/${y}`;
}

/**
 * Mensagem agregada pt-BR para o admin (sem IDs técnicos).
 * Lista no máximo 15 linhas + “e mais N”.
 */
export function buildAmortizationAlertMessage(
  links: AmortizationAlertLink[],
  targetDate: string,
): string {
  const n = links.length;
  const plural = n === 1 ? 'posição' : 'posições';
  const dateLabel = formatDatePtBr(targetDate);
  const lines: string[] = [
    `Amanhã (${dateLabel}) há amortização de cotas Sênior I: ${n} ${plural}.`,
  ];

  const shown = links.slice(0, MAX_LIST_LINES);
  for (const link of shown) {
    lines.push(`- ${link.party.legalName} / ${link.fund.name}`);
  }
  const remaining = n - shown.length;
  if (remaining > 0) {
    lines.push(`- e mais ${remaining}`);
  }

  lines.push('Acesse Cotistas no OpCore e efetue os pagamentos sem atraso.');
  return lines.join('\n');
}

export function filterEligibleAmortizationLinks(
  links: AmortizationAlertLink[],
  targetDate: string,
): AmortizationAlertLink[] {
  return links.filter((link) => {
    if (!SENIOR_I_QUOTA_TYPES.has(link.quotaType)) return false;
    if (!link.contractStartDate) return false;

    if (link.contractEndDate) {
      const end = toYYYYMMDD(link.contractEndDate);
      if (end < targetDate) return false;
    }

    const start = toYYYYMMDD(link.contractStartDate);
    return isSeniorIAmortizationDay(start, targetDate);
  });
}

async function defaultFindLinks(): Promise<AmortizationAlertLink[]> {
  const rows = await prisma.partyFundLink.findMany({
    where: {
      quotaType: { in: ['senior_i', 'senior'] },
      contractStartDate: { not: null },
    },
    include: {
      party: { select: { legalName: true } },
      fund: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    quotaType: row.quotaType,
    contractStartDate: row.contractStartDate,
    contractEndDate: row.contractEndDate,
    party: { legalName: row.party.legalName },
    fund: { name: row.fund.name },
  }));
}

async function defaultFindDelivery(
  referenceDate: string,
  channel: 'telegram' | 'whatsapp',
  destination: string,
): Promise<boolean> {
  const row = await prisma.amortizationAlertDelivery.findFirst({
    where: {
      referenceDate: parseYYYYMMDD(referenceDate),
      channel,
      destination,
      status: 'sent',
    },
  });
  return Boolean(row);
}

async function defaultRecordDelivery(
  referenceDate: string,
  channel: 'telegram' | 'whatsapp',
  destination: string,
): Promise<void> {
  try {
    await prisma.amortizationAlertDelivery.create({
      data: {
        referenceDate: parseYYYYMMDD(referenceDate),
        channel,
        destination,
        status: 'sent',
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return;
    }
    throw err;
  }
}

type ChannelDeps = {
  findDelivery: (
    referenceDate: string,
    channel: 'telegram' | 'whatsapp',
    destination: string,
  ) => Promise<boolean>;
  recordDelivery: (
    referenceDate: string,
    channel: 'telegram' | 'whatsapp',
    destination: string,
  ) => Promise<void>;
};

async function deliverTelegramChannel(input: {
  targetDate: string;
  text: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  sendTelegram: (input: {
    token?: string;
    chatId?: string;
    text: string;
  }) => Promise<SendTelegramResult>;
  deps: ChannelDeps;
}): Promise<AmortizationAlertChannelResult> {
  const destination = '';
  if (!hasTelegramDestination(input.telegramBotToken, input.telegramChatId)) {
    console.log('[job] amortization-alert telegram_skipped reason=missing_token_or_chat');
    return { channel: 'telegram', destination, reason: 'skipped' };
  }

  let alreadySent = false;
  try {
    alreadySent = await input.deps.findDelivery(input.targetDate, 'telegram', destination);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao consultar delivery telegram', err);
  }

  if (alreadySent) {
    console.log(
      `[job] amortization-alert already_sent target=${input.targetDate} channel=telegram`,
    );
    return { channel: 'telegram', destination, reason: 'already_sent' };
  }

  const sendResult = await input.sendTelegram({
    token: input.telegramBotToken,
    chatId: input.telegramChatId,
    text: input.text,
  });

  if (!sendResult.sent) {
    console.error('[job] amortization-alert telegram_error', sendResult.reason);
    return { channel: 'telegram', destination, reason: 'error' };
  }

  try {
    await input.deps.recordDelivery(input.targetDate, 'telegram', destination);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao gravar delivery telegram', err);
  }

  console.log(`[job] amortization-alert sent target=${input.targetDate} channel=telegram`);
  return { channel: 'telegram', destination, reason: 'sent' };
}

async function deliverWhatsappChannel(input: {
  targetDate: string;
  text: string;
  to: string;
  baseUrl?: string;
  apiKey?: string;
  sessionId?: string;
  sendWhatsapp: (input: {
    baseUrl?: string;
    apiKey?: string;
    sessionId?: string;
    to?: string;
    text: string;
  }) => Promise<SendWhatsappResult>;
  deps: ChannelDeps;
}): Promise<AmortizationAlertChannelResult> {
  const destination = input.to;
  if (
    !hasOpenWaDestination({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      sessionId: input.sessionId,
      to: input.to,
    })
  ) {
    console.log(
      `[job] amortization-alert whatsapp_skipped reason=missing_config destination=${destination}`,
    );
    return { channel: 'whatsapp', destination, reason: 'skipped' };
  }

  let alreadySent = false;
  try {
    alreadySent = await input.deps.findDelivery(input.targetDate, 'whatsapp', destination);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao consultar delivery whatsapp', err);
  }

  if (alreadySent) {
    console.log(
      `[job] amortization-alert already_sent target=${input.targetDate} channel=whatsapp destination=${destination}`,
    );
    return { channel: 'whatsapp', destination, reason: 'already_sent' };
  }

  const sendResult = await input.sendWhatsapp({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    sessionId: input.sessionId,
    to: input.to,
    text: input.text,
  });

  if (!sendResult.sent) {
    console.error('[job] amortization-alert whatsapp_error', sendResult.reason, {
      destination,
    });
    return { channel: 'whatsapp', destination, reason: 'error' };
  }

  try {
    await input.deps.recordDelivery(input.targetDate, 'whatsapp', destination);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao gravar delivery whatsapp', err);
  }

  console.log(
    `[job] amortization-alert sent target=${input.targetDate} channel=whatsapp destination=${destination}`,
  );
  return { channel: 'whatsapp', destination, reason: 'sent' };
}

function summarizeChannelReasons(
  channels: AmortizationAlertChannelResult[],
): AmortizationAlertJobResult['reason'] {
  const telegram = channels.find((c) => c.channel === 'telegram');
  const whatsapp = channels.filter((c) => c.channel === 'whatsapp');

  if (telegram?.reason === 'sent' || whatsapp.some((c) => c.reason === 'sent')) return 'ok';
  if (telegram?.reason === 'already_sent' && whatsapp.every((c) => c.reason === 'already_sent')) {
    return 'already_sent';
  }
  if (telegram?.reason === 'error') return 'telegram_error';
  if (whatsapp.some((c) => c.reason === 'error')) return 'whatsapp_error';
  if (telegram?.reason === 'skipped' && whatsapp.every((c) => c.reason === 'skipped')) {
    return 'telegram_skipped';
  }
  if (telegram?.reason === 'skipped') return 'telegram_skipped';
  if (whatsapp.length > 0 && whatsapp.every((c) => c.reason === 'skipped')) {
    return 'whatsapp_skipped';
  }
  return 'ok';
}

/**
 * Alerta operacional: lista amortizações Sênior I de amanhã e notifica admin
 * via Telegram e/ou WhatsApp (OpenWA). Canais independentes e idempotentes
 * por (referenceDate, channel, destination). Não derruba o daily em falhas.
 */
export async function runAmortizationAlertJob(opts?: {
  now?: Date;
  findLinks?: () => Promise<AmortizationAlertLink[]>;
  enabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  sendTelegram?: (input: {
    token?: string;
    chatId?: string;
    text: string;
  }) => Promise<SendTelegramResult>;
  openWaBaseUrl?: string;
  openWaApiKey?: string;
  openWaSessionId?: string;
  openWaSessionName?: string;
  whatsappTo?: string;
  sendWhatsapp?: (input: {
    baseUrl?: string;
    apiKey?: string;
    sessionId?: string;
    to?: string;
    text: string;
  }) => Promise<SendWhatsappResult>;
  resolveSessionId?: (input: {
    baseUrl: string;
    apiKey: string;
    sessionId?: string | null;
    sessionName?: string | null;
  }) => Promise<string | null>;
  findDelivery?: (
    referenceDate: string,
    channel: 'telegram' | 'whatsapp',
    destination: string,
  ) => Promise<boolean>;
  recordDelivery?: (
    referenceDate: string,
    channel: 'telegram' | 'whatsapp',
    destination: string,
  ) => Promise<void>;
}): Promise<AmortizationAlertJobResult> {
  const targetDate = tomorrowYYYYMMDD(opts?.now);
  const enabled = opts?.enabled ?? env.amortizationAlertEnabled;

  if (!enabled) {
    console.log('[job] amortization-alert skipped reason=disabled');
    return { targetDate, count: 0, skipped: true, reason: 'disabled' };
  }

  const telegramBotToken = opts?.telegramBotToken ?? env.telegramBotToken;
  const telegramChatId = opts?.telegramChatId ?? env.amortizationAlertTelegramChatId;
  const sendTelegram = opts?.sendTelegram ?? sendTelegramMessage;
  const openWaBaseUrl = opts?.openWaBaseUrl ?? env.openWaBaseUrl;
  const openWaApiKey = opts?.openWaApiKey ?? env.openWaApiKey;
  const openWaSessionId = opts?.openWaSessionId ?? env.openWaSessionId;
  const openWaSessionName = opts?.openWaSessionName ?? env.openWaSessionName;
  const whatsappToRaw = opts?.whatsappTo ?? env.amortizationAlertWhatsappTo;
  const sendWhatsapp = opts?.sendWhatsapp ?? sendWhatsappMessage;
  const resolveSessionId = opts?.resolveSessionId ?? resolveOpenWaSessionId;
  const findDelivery = opts?.findDelivery ?? defaultFindDelivery;
  const recordDelivery = opts?.recordDelivery ?? defaultRecordDelivery;
  const deps: ChannelDeps = { findDelivery, recordDelivery };

  let links: AmortizationAlertLink[];
  try {
    links = await (opts?.findLinks ?? defaultFindLinks)();
  } catch (err) {
    console.error('[job] amortization-alert: falha ao listar links', err);
    return { targetDate, count: 0, reason: 'ok' };
  }

  const eligible = filterEligibleAmortizationLinks(links, targetDate);
  console.log(`[job] amortization-alert target=${targetDate} count=${eligible.length}`);
  for (const link of eligible) {
    console.log(`[job] amortization-alert — ${link.party.legalName} / ${link.fund.name}`);
  }

  if (eligible.length === 0) {
    return { targetDate, count: 0, reason: 'ok' };
  }

  const text = buildAmortizationAlertMessage(eligible, targetDate);
  const channels: AmortizationAlertChannelResult[] = [];

  try {
    channels.push(
      await deliverTelegramChannel({
        targetDate,
        text,
        telegramBotToken,
        telegramChatId,
        sendTelegram,
        deps,
      }),
    );
  } catch (err) {
    console.error('[job] amortization-alert: exceção telegram', err);
    channels.push({ channel: 'telegram', destination: '', reason: 'error' });
  }

  const destinations = parseWhatsappDestinations(whatsappToRaw);
  let resolvedSessionId: string | null | undefined = openWaSessionId?.trim() || undefined;

  if (destinations.length > 0 && openWaBaseUrl?.trim() && openWaApiKey?.trim()) {
    if (!resolvedSessionId) {
      try {
        resolvedSessionId = await resolveSessionId({
          baseUrl: openWaBaseUrl,
          apiKey: openWaApiKey,
          sessionId: openWaSessionId,
          sessionName: openWaSessionName,
        });
      } catch (err) {
        console.error('[job] amortization-alert: falha ao resolver sessão OpenWA', err);
        resolvedSessionId = null;
      }
    }
  }

  if (destinations.length === 0) {
    // nothing — WhatsApp not configured
  } else if (!openWaBaseUrl?.trim() || !openWaApiKey?.trim() || !resolvedSessionId) {
    console.log('[job] amortization-alert whatsapp_skipped reason=missing_openwa_or_session');
    for (const to of destinations) {
      channels.push({ channel: 'whatsapp', destination: to, reason: 'skipped' });
    }
  } else {
    for (const to of destinations) {
      try {
        channels.push(
          await deliverWhatsappChannel({
            targetDate,
            text,
            to,
            baseUrl: openWaBaseUrl,
            apiKey: openWaApiKey,
            sessionId: resolvedSessionId,
            sendWhatsapp,
            deps,
          }),
        );
      } catch (err) {
        console.error('[job] amortization-alert: exceção whatsapp', err);
        channels.push({ channel: 'whatsapp', destination: to, reason: 'error' });
      }
    }
  }

  const reason = summarizeChannelReasons(channels);
  return { targetDate, count: eligible.length, reason, channels };
}
