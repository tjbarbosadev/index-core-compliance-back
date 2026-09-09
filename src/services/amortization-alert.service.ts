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

export type AmortizationAlertJobResult = {
  targetDate: string;
  count: number;
  skipped?: boolean;
  reason?: 'disabled' | 'telegram_skipped' | 'ok' | 'already_sent' | 'telegram_error';
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

async function defaultFindDelivery(referenceDate: string): Promise<boolean> {
  const row = await prisma.amortizationAlertDelivery.findFirst({
    where: {
      referenceDate: parseYYYYMMDD(referenceDate),
      channel: 'telegram',
      status: 'sent',
    },
  });
  return Boolean(row);
}

async function defaultRecordDelivery(referenceDate: string): Promise<void> {
  try {
    await prisma.amortizationAlertDelivery.create({
      data: {
        referenceDate: parseYYYYMMDD(referenceDate),
        channel: 'telegram',
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

/**
 * Alerta operacional: lista amortizações Sênior I de amanhã e notifica admin via Telegram.
 * Idempotente por (referenceDate, channel). Não derruba o daily em falhas.
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
  findDelivery?: (referenceDate: string) => Promise<boolean>;
  recordDelivery?: (referenceDate: string) => Promise<void>;
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
  const findDelivery = opts?.findDelivery ?? defaultFindDelivery;
  const recordDelivery = opts?.recordDelivery ?? defaultRecordDelivery;

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

  if (!hasTelegramDestination(telegramBotToken, telegramChatId)) {
    console.log('[job] amortization-alert telegram_skipped reason=missing_token_or_chat');
    return { targetDate, count: eligible.length, reason: 'telegram_skipped' };
  }

  let alreadySent = false;
  try {
    alreadySent = await findDelivery(targetDate);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao consultar delivery', err);
  }

  if (alreadySent) {
    console.log(`[job] amortization-alert already_sent target=${targetDate} channel=telegram`);
    return { targetDate, count: eligible.length, reason: 'already_sent' };
  }

  const text = buildAmortizationAlertMessage(eligible, targetDate);
  const sendResult = await sendTelegram({
    token: telegramBotToken,
    chatId: telegramChatId,
    text,
  });

  if (!sendResult.sent) {
    console.error('[job] amortization-alert telegram_error', sendResult.reason);
    return { targetDate, count: eligible.length, reason: 'telegram_error' };
  }

  try {
    await recordDelivery(targetDate);
  } catch (err) {
    console.error('[job] amortization-alert: falha ao gravar delivery', err);
  }

  console.log(`[job] amortization-alert sent target=${targetDate} channel=telegram`);
  return { targetDate, count: eligible.length, reason: 'ok' };
}
