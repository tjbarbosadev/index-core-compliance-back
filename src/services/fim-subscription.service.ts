import { prisma } from '../db/index.js';
import { digitsOnly } from '../lib/party.js';
import { logAudit } from './audit.service.js';
import { sendFimSubscriptionNotice } from './email.service.js';
import { backfillPartyFundLinkYields, getLatestYieldOnOrBefore } from './cotista-yield.service.js';
import {
  addDays,
  getVisualizationDate,
  parseYYYYMMDD,
  todayYYYYMMDD,
  toYYYYMMDD,
} from './quota-calculator.js';

export const FIM_MIN_BRL = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_WINDOWS = new Set([30, 60, 90]);

export class FimPartnerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type FimSubscriptionInput = {
  name: string;
  document: string;
  email?: string;
  phone?: string;
  amountBrl: number;
  externalId: string;
  fundId?: string;
};

export type FimSubscriptionResult = 'created' | 'toppedUp';

export type FimPositionView = {
  name: string;
  document: string;
  /** Aportado líquido de resgates já liquidados (pendentes ainda não reduzem). */
  totalContributed: number;
  quotaCount: number;
  balance: number;
  yieldDay: number;
  yieldAccumulated: number;
  startDate: string;
  visualizationDate: string;
  pendingRedemptionTotal: number;
  availableToRedeem: number;
  frozenUntil: string | null;
  yielding: boolean;
};

export type FimSubscribeResponse = {
  document: string;
  result: FimSubscriptionResult;
  amountBrl: number;
  totalContributed: number;
  balance: number;
  yieldAccumulated: number;
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function atMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFimSubscription(
  body: unknown,
): { ok: true; input: FimSubscriptionInput } | { ok: false; message: string } {
  if (!isRecord(body)) return { ok: false, message: 'Corpo inválido' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, message: 'Informe name' };
  const document = typeof body.document === 'string' ? digitsOnly(body.document) : '';
  if (document.length !== 11 && document.length !== 14) {
    return { ok: false, message: 'document deve ser CPF (11) ou CNPJ (14), só dígitos' };
  }
  if (typeof body.amountBrl !== 'number' || !atMostTwoDecimals(body.amountBrl)) {
    return { ok: false, message: 'amountBrl deve ser um número com no máximo duas casas' };
  }
  if (body.amountBrl < FIM_MIN_BRL) {
    return { ok: false, message: 'amountBrl mínimo é 100' };
  }
  const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : '';
  if (!externalId || externalId.length > 128) {
    return { ok: false, message: 'Informe externalId com até 128 caracteres' };
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'email inválido' };
  }
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const fundId = typeof body.fundId === 'string' ? body.fundId.trim() : '';
  if (fundId && !/^[0-9a-f-]{36}$/i.test(fundId)) {
    return { ok: false, message: 'fundId inválido' };
  }
  return {
    ok: true,
    input: {
      name,
      document,
      email: email || undefined,
      phone: phone || undefined,
      amountBrl: money(body.amountBrl),
      externalId,
      fundId: fundId || undefined,
    },
  };
}

export function resolveYieldWindow(input: {
  days?: string;
  from?: string;
  to?: string;
  contractStart: string;
  visualizationDate: string;
}): { ok: true; from: string; to: string; empty: boolean } | { ok: false; message: string } {
  const hasDays = Boolean(input.days);
  const hasFrom = Boolean(input.from);
  const hasTo = Boolean(input.to);
  if (hasDays && (hasFrom || hasTo)) {
    return { ok: false, message: 'Informe days ou from e to, não os dois' };
  }
  if (!hasDays && !(hasFrom && hasTo)) {
    return { ok: false, message: 'Informe days=30, 60 ou 90, ou from e to' };
  }
  if ((hasFrom && !hasTo) || (!hasFrom && hasTo)) {
    return { ok: false, message: 'Informe from e to juntos' };
  }

  let from: string;
  let to: string;
  if (hasDays) {
    const count = Number(input.days);
    if (!DAY_WINDOWS.has(count)) return { ok: false, message: 'days deve ser 30, 60 ou 90' };
    to = input.visualizationDate;
    from = toYYYYMMDD(addDays(parseYYYYMMDD(to), -(count - 1)));
  } else {
    from = input.from ?? '';
    to = input.to ?? '';
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return { ok: false, message: 'from e to devem ser YYYY-MM-DD' };
    }
    if (from > to) return { ok: false, message: 'from não pode ser posterior a to' };
  }

  if (from < input.contractStart) from = input.contractStart;
  if (to > input.visualizationDate) to = input.visualizationDate;
  return { ok: true, from, to, empty: from > to };
}

function normalizeDocument(document: string): string {
  const digits = digitsOnly(document);
  if (digits.length !== 11 && digits.length !== 14) {
    throw new FimPartnerError(400, 'document deve ser CPF (11) ou CNPJ (14), só dígitos');
  }
  return digits;
}

async function resolveFimFund(fundId?: string) {
  if (fundId) {
    const fund = await prisma.fund.findFirst({
      where: { id: fundId, modality: 'fim', status: 'ativo' },
    });
    if (!fund) throw new FimPartnerError(404, 'Fundo não encontrado');
    return fund;
  }
  const funds = await prisma.fund.findMany({
    where: { modality: 'fim', status: 'ativo' },
    orderBy: { name: 'asc' },
  });
  if (funds.length === 0) throw new FimPartnerError(404, 'Fundo não encontrado');
  if (funds.length > 1) throw new FimPartnerError(400, 'Informe fundId');
  return funds[0]!;
}

async function loadFimLink(document: string) {
  const party = await prisma.party.findFirst({
    where: { cpfCnpj: document, deletedAt: null },
    include: {
      cotista: true,
      partyFundLinks: { include: { fund: true } },
    },
  });
  if (!party?.cotista) return null;
  const links = party.partyFundLinks
    .filter((link) => link.quotaType === 'unica' && link.fund.modality === 'fim')
    .sort((a, b) => {
      const aStart = a.contractStartDate?.getTime() ?? a.linkedAt.getTime();
      const bStart = b.contractStartDate?.getTime() ?? b.linkedAt.getTime();
      return aStart - bStart;
    });
  const link = links[0];
  if (!link) return null;
  return { party, cotista: party.cotista, link };
}

async function positionView(
  linkId: string,
  name: string,
  document: string,
): Promise<FimPositionView> {
  const visualizationDate = toYYYYMMDD(getVisualizationDate());
  const today = todayYYYYMMDD();
  const [subscriptions, redemptions, link] = await Promise.all([
    prisma.fimSubscription.findMany({
      where: { partyFundLinkId: linkId },
      orderBy: { occurredOn: 'asc' },
    }),
    prisma.fimRedemption.findMany({
      where: { partyFundLinkId: linkId },
      orderBy: { requestedOn: 'asc' },
    }),
    prisma.partyFundLink.findUnique({ where: { id: linkId } }),
  ]);
  const grossContributed =
    subscriptions.length > 0
      ? subscriptions.reduce((sum, row) => sum + Number(row.amount), 0)
      : Number(link?.initialInvestment ?? 0);
  const settledRedeemed = redemptions
    .filter((row) => row.status === 'settled' || toYYYYMMDD(row.settlesOn) <= visualizationDate)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const pendingRedemptionTotal = money(
    redemptions
      .filter((row) => row.status === 'pending' && toYYYYMMDD(row.settlesOn) > visualizationDate)
      .reduce((sum, row) => sum + Number(row.amount), 0),
  );
  const totalContributed = money(grossContributed - settledRedeemed);
  const availableToRedeem = money(
    Math.max(0, totalContributed - pendingRedemptionTotal - FIM_MIN_BRL),
  );
  const activeFreezes = redemptions.filter((row) => {
    const from = toYYYYMMDD(row.requestedOn);
    const toExclusive = toYYYYMMDD(row.settlesOn);
    return today >= from && today < toExclusive;
  });
  const frozenUntil =
    activeFreezes.length > 0
      ? activeFreezes
          .map((row) => toYYYYMMDD(row.settlesOn))
          .sort()
          .at(-1)!
      : null;
  const latest = await getLatestYieldOnOrBefore(linkId, visualizationDate);
  const latestDate = latest ? toYYYYMMDD(latest.referenceDate) : null;
  const pendingSubs = subscriptions
    .filter((row) => !latestDate || toYYYYMMDD(row.occurredOn) > latestDate)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const pendingSettledRedemptions = redemptions
    .filter((row) => {
      const settlesOn = toYYYYMMDD(row.settlesOn);
      return (!latestDate || settlesOn > latestDate) && settlesOn <= visualizationDate;
    })
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const balance = money(
    (latest ? Number(latest.balanceTotal) : 0) + pendingSubs - pendingSettledRedemptions,
  );
  const startDate =
    (subscriptions[0] ? toYYYYMMDD(subscriptions[0].occurredOn) : null) ??
    (link?.contractStartDate ? toYYYYMMDD(link.contractStartDate) : visualizationDate);
  return {
    name,
    document,
    totalContributed,
    quotaCount: totalContributed,
    balance,
    yieldDay: latest && latestDate === visualizationDate ? money(Number(latest.yieldDay)) : 0,
    yieldAccumulated: money(latest ? Number(latest.yieldAccumulated) : 0),
    startDate,
    visualizationDate,
    pendingRedemptionTotal,
    availableToRedeem,
    frozenUntil,
    yielding: frozenUntil === null,
  };
}

function subscribePayload(
  view: FimPositionView,
  result: FimSubscriptionResult,
  amountBrl: number,
): FimSubscribeResponse {
  return {
    document: view.document,
    result,
    amountBrl,
    totalContributed: view.totalContributed,
    balance: view.balance,
    yieldAccumulated: view.yieldAccumulated,
  };
}

export async function subscribeFim(input: {
  partner: { id: string; name: string };
  body: FimSubscriptionInput;
  ip?: string | null;
}): Promise<FimSubscribeResponse> {
  const fund = await resolveFimFund(input.body.fundId);
  const document = input.body.document;
  const today = todayYYYYMMDD();

  const duplicate = await prisma.fimSubscription.findUnique({
    where: {
      partnerId_externalId: { partnerId: input.partner.id, externalId: input.body.externalId },
    },
    include: { partyFundLink: { include: { party: true } } },
  });
  if (duplicate) {
    if (
      duplicate.partyFundLink.party.cpfCnpj !== document ||
      duplicate.partyFundLink.fundId !== fund.id
    ) {
      throw new FimPartnerError(409, 'externalId já usado');
    }
    const earlier = await prisma.fimSubscription.count({
      where: {
        partyFundLinkId: duplicate.partyFundLinkId,
        OR: [
          { occurredOn: { lt: duplicate.occurredOn } },
          { occurredOn: duplicate.occurredOn, createdAt: { lt: duplicate.createdAt } },
        ],
      },
    });
    const view = await positionView(
      duplicate.partyFundLinkId,
      duplicate.partyFundLink.party.legalName,
      document,
    );
    return subscribePayload(
      view,
      earlier === 0 ? 'created' : 'toppedUp',
      money(Number(duplicate.amount)),
    );
  }

  const party = await prisma.party.findFirst({
    where: { cpfCnpj: document, deletedAt: null },
    include: { cotista: true, partyFundLinks: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    let partyId = party?.id;
    let cotistaId = party?.cotista?.id;
    let createdParty = false;

    if (!partyId) {
      const row = await tx.party.create({
        data: {
          type: document.length <= 11 ? 'pf' : 'pj',
          cpfCnpj: document,
          legalName: input.body.name,
          status: 'aprovado',
          riskLevel: 'baixo',
          pepFlag: false,
          excludeFromPl: true,
          approvedAt: new Date(),
        },
      });
      partyId = row.id;
      createdParty = true;
    }

    if (!cotistaId) {
      const row = await tx.cotista.create({ data: { partyId } });
      cotistaId = row.id;
    }

    if (input.body.email || input.body.phone) {
      const contact = await tx.partyContact.findFirst({
        where: { partyId, isPrimary: true },
      });
      if (contact) {
        await tx.partyContact.update({
          where: { id: contact.id },
          data: {
            email: input.body.email ?? contact.email,
            phone: input.body.phone?.slice(0, 30) ?? contact.phone,
          },
        });
      } else {
        await tx.partyContact.create({
          data: {
            partyId,
            email: input.body.email ?? null,
            phone: input.body.phone?.slice(0, 30) ?? null,
            isPrimary: true,
          },
        });
      }
    }

    const existingLink = party?.partyFundLinks.find(
      (link) => link.fundId === fund.id && link.quotaType === 'unica',
    );
    let linkId = existingLink?.id;
    let result: FimSubscriptionResult = 'toppedUp';
    if (!linkId) {
      const link = await tx.partyFundLink.create({
        data: {
          partyId,
          fundId: fund.id,
          quotaType: 'unica',
          initialInvestment: input.body.amountBrl,
          currentPrincipal: input.body.amountBrl,
          quotaAmount: input.body.amountBrl,
          quotaCount: Math.round(input.body.amountBrl),
          contractStartDate: parseYYYYMMDD(today),
        },
      });
      linkId = link.id;
      result = 'created';
    }

    await tx.fimSubscription.create({
      data: {
        partyFundLinkId: linkId,
        partnerId: input.partner.id,
        externalId: input.body.externalId,
        amount: input.body.amountBrl,
        occurredOn: parseYYYYMMDD(today),
      },
    });

    if (result === 'toppedUp') {
      const [rows, settled] = await Promise.all([
        tx.fimSubscription.findMany({ where: { partyFundLinkId: linkId } }),
        tx.fimRedemption.findMany({ where: { partyFundLinkId: linkId, status: 'settled' } }),
      ]);
      const gross = rows.reduce((sum, row) => sum + Number(row.amount), 0);
      const redeemed = settled.reduce((sum, row) => sum + Number(row.amount), 0);
      const total = money(gross - redeemed);
      await tx.partyFundLink.update({
        where: { id: linkId },
        data: {
          initialInvestment: total,
          currentPrincipal: total,
          quotaAmount: total,
          quotaCount: Math.round(total),
        },
      });
    }

    return { partyId, cotistaId, linkId, result, createdParty };
  });

  await backfillPartyFundLinkYields(created.linkId);

  const view = await positionView(created.linkId, input.body.name, document);
  const payload = subscribePayload(view, created.result, input.body.amountBrl);

  await logAudit({
    action: 'fim.subscription',
    entityType: 'cotista',
    entityId: created.cotistaId,
    details: {
      partnerId: input.partner.id,
      externalId: input.body.externalId,
      amountBrl: input.body.amountBrl,
      result: created.result,
      document,
      excludeFromPl: created.createdParty,
    },
    ipAddress: input.ip ?? undefined,
  });

  try {
    await sendFimSubscriptionNotice({
      name: input.body.name,
      document,
      email: input.body.email,
      phone: input.body.phone,
      amountBrl: input.body.amountBrl,
      totalContributed: payload.totalContributed,
      externalId: input.body.externalId,
      result: created.result,
      partnerName: input.partner.name,
    });
  } catch (err) {
    console.error('[fim.subscription] e-mail aos admins falhou:', err);
  }

  return payload;
}

export async function getFimShareholder(documentRaw: string): Promise<FimPositionView> {
  const document = normalizeDocument(documentRaw);
  const loaded = await loadFimLink(document);
  if (!loaded) throw new FimPartnerError(404, 'Posição FIM não encontrada');
  return positionView(loaded.link.id, loaded.party.legalName, document);
}

export async function getFimShareholderYields(
  documentRaw: string,
  query: { days?: string; from?: string; to?: string },
) {
  const document = normalizeDocument(documentRaw);
  const loaded = await loadFimLink(document);
  if (!loaded) throw new FimPartnerError(404, 'Posição FIM não encontrada');
  const view = await positionView(loaded.link.id, loaded.party.legalName, document);
  const window = resolveYieldWindow({
    days: query.days,
    from: query.from,
    to: query.to,
    contractStart: view.startDate,
    visualizationDate: view.visualizationDate,
  });
  if (!window.ok) throw new FimPartnerError(400, window.message);

  const items = window.empty
    ? []
    : await prisma.cotistaDailyYield.findMany({
        where: {
          partyFundLinkId: loaded.link.id,
          referenceDate: {
            gte: parseYYYYMMDD(window.from),
            lte: parseYYYYMMDD(window.to),
          },
        },
        orderBy: { referenceDate: 'asc' },
      });

  return {
    visualizationDate: view.visualizationDate,
    from: window.from,
    to: window.to,
    items: items.map((row) => ({
      referenceDate: toYYYYMMDD(row.referenceDate),
      selicPercent: Number(row.selicPercent),
      principal: Number(row.principal),
      yieldDay: Number(row.yieldDay),
      yieldAccumulated: Number(row.yieldAccumulated),
      balanceTotal: Number(row.balanceTotal),
    })),
  };
}
