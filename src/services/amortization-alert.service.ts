import { Prisma } from '@prisma/client';
import { env } from '../lib/env.js';
import { prisma } from '../db/index.js';
import {
  isSeniorIAmortizationDay,
  parseYYYYMMDD,
  toYYYYMMDD,
  todayYYYYMMDD,
  tomorrowYYYYMMDD,
} from './quota-calculator.js';
import { sendTelegramMessage, type SendTelegramResult } from './telegram.service.js';
import {
  hasOpenWaDestination,
  parseWhatsappDestinations,
  sendWhatsappMessage,
  type SendWhatsappResult,
} from './whatsapp.service.js';
import {
  listReadyWhatsappPhones,
  resolveSenderOpenWaSessionId,
} from './whatsapp-session.service.js';

const SENIOR_I_QUOTA_TYPES = new Set(['senior_i', 'senior']);
const MAX_LIST_LINES = 15;

export const AMORTIZATION_ALERT_SLOTS = ['d1_am', 'd1_pm', 'd0_am', 'd0_pm'] as const;
export type AmortizationAlertSlot = (typeof AMORTIZATION_ALERT_SLOTS)[number];

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
  slot: AmortizationAlertSlot;
  reason: 'skipped' | 'already_sent' | 'error' | 'sent' | 'ok';
};

export type AmortizationAlertJobResult = {
  targetDate: string;
  slot: AmortizationAlertSlot;
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

export function slotMode(slot: AmortizationAlertSlot): 'd1' | 'd0' {
  return slot.startsWith('d0') ? 'd0' : 'd1';
}

/**
 * Mensagem agregada pt-BR para o admin (sem IDs técnicos).
 * Lista no máximo 15 linhas + “e mais N”.
 */
export function buildAmortizationAlertMessage(
  links: AmortizationAlertLink[],
  targetDate: string,
  opts?: { when?: 'tomorrow' | 'today' },
): string {
  const n = links.length;
  const plural = n === 1 ? 'posição' : 'posições';
  const dateLabel = formatDatePtBr(targetDate);
  const when = opts?.when ?? 'tomorrow';
  const headline =
    when === 'today'
      ? `Hoje (${dateLabel}) há amortização de cotas Sênior I: ${n} ${plural}.`
      : `Amanhã (${dateLabel}) há amortização de cotas Sênior I: ${n} ${plural}.`;
  const lines: string[] = [headline];

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

export function mergeWhatsappDestinations(
  sessionPhones: string[],
  envRaw?: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const phone of [...sessionPhones, ...parseWhatsappDestinations(envRaw)]) {
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
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
  slot: AmortizationAlertSlot,
): Promise<boolean> {
  const row = await prisma.amortizationAlertDelivery.findFirst({
    where: {
      referenceDate: parseYYYYMMDD(referenceDate),
      channel,
      destination,
      slot,
      status: 'sent',
    },
  });
  return Boolean(row);
}

async function defaultRecordDelivery(
  referenceDate: string,
  channel: 'telegram' | 'whatsapp',
  destination: string,
  slot: AmortizationAlertSlot,
): Promise<void> {
  try {
    await prisma.amortizationAlertDelivery.create({
      data: {
        referenceDate: parseYYYYMMDD(referenceDate),
        channel,
        destination,
        slot,
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
    slot: AmortizationAlertSlot,
  ) => Promise<boolean>;
  recordDelivery: (
    referenceDate: string,
    channel: 'telegram' | 'whatsapp',
    destination: string,
    slot: AmortizationAlertSlot,
  ) => Promise<void>;
};

async function deliverTelegramChannel(input: {
  targetDate: string;
  slot: AmortizationAlertSlot;
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
    return { channel: 'telegram', destination, slot: input.slot, reason: 'skipped' };
  }

  let alreadySent = false;
  try {
    alreadySent = await input.deps.findDelivery(
      input.targetDate,
      'telegram',
      destination,
      input.slot,
    );
  } catch (err) {
    console.error('[job] amortization-alert: falha ao consultar delivery telegram', err);
  }

  if (alreadySent) {
    console.log(
      `[job] amortization-alert already_sent target=${input.targetDate} slot=${input.slot} channel=telegram`,
    );
    return { channel: 'telegram', destination, slot: input.slot, reason: 'already_sent' };
  }

  const sendResult = await input.sendTelegram({
    token: input.telegramBotToken,
    chatId: input.telegramChatId,
    text: input.text,
  });

  if (!sendResult.sent) {
    console.error('[job] amortization-alert telegram_error', sendResult.reason);
    return { channel: 'telegram', destination, slot: input.slot, reason: 'error' };
  }

  try {
    await input.deps.recordDelivery(input.targetDate, 'telegram', destination, input.slot);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao gravar delivery telegram', err);
  }

  console.log(
    `[job] amortization-alert sent target=${input.targetDate} slot=${input.slot} channel=telegram`,
  );
  return { channel: 'telegram', destination, slot: input.slot, reason: 'sent' };
}

async function deliverWhatsappChannel(input: {
  targetDate: string;
  slot: AmortizationAlertSlot;
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
    return { channel: 'whatsapp', destination, slot: input.slot, reason: 'skipped' };
  }

  let alreadySent = false;
  try {
    alreadySent = await input.deps.findDelivery(
      input.targetDate,
      'whatsapp',
      destination,
      input.slot,
    );
  } catch (err) {
    console.error('[job] amortization-alert: falha ao consultar delivery whatsapp', err);
  }

  if (alreadySent) {
    console.log(
      `[job] amortization-alert already_sent target=${input.targetDate} slot=${input.slot} channel=whatsapp destination=${destination}`,
    );
    return { channel: 'whatsapp', destination, slot: input.slot, reason: 'already_sent' };
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
    return { channel: 'whatsapp', destination, slot: input.slot, reason: 'error' };
  }

  try {
    await input.deps.recordDelivery(input.targetDate, 'whatsapp', destination, input.slot);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao gravar delivery whatsapp', err);
  }

  console.log(
    `[job] amortization-alert sent target=${input.targetDate} slot=${input.slot} channel=whatsapp destination=${destination}`,
  );
  return { channel: 'whatsapp', destination, slot: input.slot, reason: 'sent' };
}

function summarizeChannelReasons(
  channels: AmortizationAlertChannelResult[],
): AmortizationAlertJobResult['reason'] {
  const telegram = channels.find((c) => c.channel === 'telegram');
  const whatsapp = channels.filter((c) => c.channel === 'whatsapp');

  if (telegram?.reason === 'sent' || whatsapp.some((c) => c.reason === 'sent')) return 'ok';
  if (
    telegram?.reason === 'already_sent' &&
    (whatsapp.length === 0 || whatsapp.every((c) => c.reason === 'already_sent'))
  ) {
    return 'already_sent';
  }
  if (telegram?.reason === 'error') return 'telegram_error';
  if (whatsapp.some((c) => c.reason === 'error')) return 'whatsapp_error';
  if (
    telegram?.reason === 'skipped' &&
    (whatsapp.length === 0 || whatsapp.every((c) => c.reason === 'skipped'))
  ) {
    return 'telegram_skipped';
  }
  if (telegram?.reason === 'skipped') return 'telegram_skipped';
  if (whatsapp.length > 0 && whatsapp.every((c) => c.reason === 'skipped')) {
    return 'whatsapp_skipped';
  }
  return 'ok';
}

/**
 * Alerta operacional Sênior I com slots D−1 / D0 (09h e 15h BRT).
 * WhatsApp: destinatários = sessões ready (opt-in) + merge env.
 * Idempotência: (referenceDate, channel, destination, slot).
 */
export async function runAmortizationAlertJob(opts?: {
  now?: Date;
  slot?: AmortizationAlertSlot;
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
  whatsappTo?: string;
  readyPhones?: string[];
  resolveSenderSessionId?: () => Promise<string | null>;
  sendWhatsapp?: (input: {
    baseUrl?: string;
    apiKey?: string;
    sessionId?: string;
    to?: string;
    text: string;
  }) => Promise<SendWhatsappResult>;
  findDelivery?: (
    referenceDate: string,
    channel: 'telegram' | 'whatsapp',
    destination: string,
    slot: AmortizationAlertSlot,
  ) => Promise<boolean>;
  recordDelivery?: (
    referenceDate: string,
    channel: 'telegram' | 'whatsapp',
    destination: string,
    slot: AmortizationAlertSlot,
  ) => Promise<void>;
}): Promise<AmortizationAlertJobResult> {
  const slot: AmortizationAlertSlot = opts?.slot ?? 'd1_am';
  const mode = slotMode(slot);
  const targetDate = mode === 'd0' ? todayYYYYMMDD(opts?.now) : tomorrowYYYYMMDD(opts?.now);
  const enabled = opts?.enabled ?? env.amortizationAlertEnabled;

  if (!enabled) {
    console.log(`[job] amortization-alert skipped reason=disabled slot=${slot}`);
    return { targetDate, slot, count: 0, skipped: true, reason: 'disabled' };
  }

  const telegramBotToken = opts?.telegramBotToken ?? env.telegramBotToken;
  const telegramChatId = opts?.telegramChatId ?? env.amortizationAlertTelegramChatId;
  const sendTelegram = opts?.sendTelegram ?? sendTelegramMessage;
  const openWaBaseUrl = opts?.openWaBaseUrl ?? env.openWaBaseUrl;
  const openWaApiKey = opts?.openWaApiKey ?? env.openWaApiKey;
  const openWaSessionIdOverride = opts?.openWaSessionId ?? env.openWaSessionId;
  const whatsappToRaw = opts?.whatsappTo ?? env.amortizationAlertWhatsappTo;
  const sendWhatsapp = opts?.sendWhatsapp ?? sendWhatsappMessage;
  const findDelivery = opts?.findDelivery ?? defaultFindDelivery;
  const recordDelivery = opts?.recordDelivery ?? defaultRecordDelivery;
  const deps: ChannelDeps = { findDelivery, recordDelivery };

  let links: AmortizationAlertLink[];
  try {
    links = await (opts?.findLinks ?? defaultFindLinks)();
  } catch (err) {
    console.error('[job] amortization-alert: falha ao listar links', err);
    return { targetDate, slot, count: 0, reason: 'ok' };
  }

  const eligible = filterEligibleAmortizationLinks(links, targetDate);
  console.log(
    `[job] amortization-alert target=${targetDate} slot=${slot} count=${eligible.length}`,
  );
  for (const link of eligible) {
    console.log(`[job] amortization-alert — ${link.party.legalName} / ${link.fund.name}`);
  }

  if (eligible.length === 0) {
    return { targetDate, slot, count: 0, reason: 'ok' };
  }

  const when = mode === 'd0' ? 'today' : 'tomorrow';
  const text = buildAmortizationAlertMessage(eligible, targetDate, { when });
  const channels: AmortizationAlertChannelResult[] = [];

  try {
    channels.push(
      await deliverTelegramChannel({
        targetDate,
        slot,
        text,
        telegramBotToken,
        telegramChatId,
        sendTelegram,
        deps,
      }),
    );
  } catch (err) {
    console.error('[job] amortization-alert: exceção telegram', err);
    channels.push({ channel: 'telegram', destination: '', slot, reason: 'error' });
  }

  let sessionPhones: string[] = opts?.readyPhones ?? [];
  if (opts?.readyPhones === undefined) {
    try {
      sessionPhones = await listReadyWhatsappPhones();
    } catch (err) {
      console.error('[job] amortization-alert: falha ao listar sessões WhatsApp', err);
      sessionPhones = [];
    }
  }

  const destinations = mergeWhatsappDestinations(sessionPhones, whatsappToRaw);

  let resolvedSessionId: string | null =
    openWaSessionIdOverride?.trim() ||
    (opts?.resolveSenderSessionId ? await opts.resolveSenderSessionId().catch(() => null) : null);

  if (!resolvedSessionId && openWaBaseUrl?.trim() && openWaApiKey?.trim()) {
    try {
      resolvedSessionId = await resolveSenderOpenWaSessionId();
    } catch (err) {
      console.error('[job] amortization-alert: falha ao resolver sessão remetente', err);
      resolvedSessionId = null;
    }
  }

  if (destinations.length === 0) {
    // nothing
  } else if (!openWaBaseUrl?.trim() || !openWaApiKey?.trim() || !resolvedSessionId) {
    console.log('[job] amortization-alert whatsapp_skipped reason=missing_openwa_or_session');
    for (const to of destinations) {
      channels.push({ channel: 'whatsapp', destination: to, slot, reason: 'skipped' });
    }
  } else {
    for (const to of destinations) {
      try {
        channels.push(
          await deliverWhatsappChannel({
            targetDate,
            slot,
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
        channels.push({ channel: 'whatsapp', destination: to, slot, reason: 'error' });
      }
    }
  }

  const reason = summarizeChannelReasons(channels);
  return { targetDate, slot, count: eligible.length, reason, channels };
}

/** Roda D−1 e D0 no mesmo horário (09h ou 15h). */
export async function runAmortizationAlertSlotBatch(
  period: 'am' | 'pm',
  opts?: Parameters<typeof runAmortizationAlertJob>[0],
): Promise<AmortizationAlertJobResult[]> {
  const d1Slot: AmortizationAlertSlot = period === 'am' ? 'd1_am' : 'd1_pm';
  const d0Slot: AmortizationAlertSlot = period === 'am' ? 'd0_am' : 'd0_pm';
  const d1 = await runAmortizationAlertJob({ ...opts, slot: d1Slot });
  const d0 = await runAmortizationAlertJob({ ...opts, slot: d0Slot });
  return [d1, d0];
}
