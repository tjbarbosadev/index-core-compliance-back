import { prisma } from '../db/index.js';
import { digitsOnly } from '../lib/party.js';
import { addB3BusinessDays } from '../lib/b3-calendar.js';
import { logAudit } from './audit.service.js';
import { sendFimRedemptionNotice } from './email.service.js';
import { backfillPartyFundLinkYields } from './cotista-yield.service.js';
import {
  FimPartnerError,
  getFimShareholder,
  type FimPositionView,
} from './fim-subscription.service.js';
import { parseYYYYMMDD, todayYYYYMMDD, toYYYYMMDD } from './quota-calculator.js';

export type FimRedemptionInput = {
  document: string;
  amountBrl: number;
  externalId: string;
};

export type FimRedeemResponse = {
  document: string;
  result: 'pending';
  amountBrl: number;
  settlesOn: string;
  totalContributed: number;
  availableToRedeem: number;
  frozenAmount: number;
  frozenUntil: string | null;
  balance: number;
  yieldAccumulated: number;
  dryRun?: boolean;
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

export function parseFimRedemption(
  body: unknown,
): { ok: true; input: FimRedemptionInput } | { ok: false; message: string } {
  if (!isRecord(body)) return { ok: false, message: 'Corpo inválido' };
  const document = typeof body.document === 'string' ? digitsOnly(body.document) : '';
  if (document.length !== 11 && document.length !== 14) {
    return { ok: false, message: 'document deve ser CPF (11) ou CNPJ (14), só dígitos' };
  }
  if (typeof body.amountBrl !== 'number' || !atMostTwoDecimals(body.amountBrl)) {
    return { ok: false, message: 'amountBrl deve ser um número com no máximo duas casas' };
  }
  if (body.amountBrl <= 0) {
    return { ok: false, message: 'amountBrl deve ser maior que zero' };
  }
  const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : '';
  if (!externalId || externalId.length > 128) {
    return { ok: false, message: 'Informe externalId com até 128 caracteres' };
  }
  return {
    ok: true,
    input: {
      document,
      amountBrl: money(body.amountBrl),
      externalId,
    },
  };
}

function redeemPayload(
  view: FimPositionView,
  amountBrl: number,
  settlesOn: string,
  dryRun?: boolean,
): FimRedeemResponse {
  return {
    document: view.document,
    result: 'pending',
    amountBrl,
    settlesOn,
    totalContributed: view.totalContributed,
    availableToRedeem: view.availableToRedeem,
    frozenAmount: view.frozenAmount,
    frozenUntil: view.frozenUntil,
    balance: view.balance,
    yieldAccumulated: view.yieldAccumulated,
    ...(dryRun ? { dryRun: true } : {}),
  };
}

export async function redeemFim(input: {
  partner: { id: string; name: string };
  body: FimRedemptionInput;
  ip?: string | null;
  dryRun?: boolean;
  now?: Date;
}): Promise<FimRedeemResponse> {
  const document = input.body.document;
  const today = todayYYYYMMDD(input.now);
  const settlesOn = toYYYYMMDD(addB3BusinessDays(parseYYYYMMDD(today), 5));

  const duplicate = await prisma.fimRedemption.findUnique({
    where: {
      partnerId_externalId: { partnerId: input.partner.id, externalId: input.body.externalId },
    },
    include: { partyFundLink: { include: { party: true } } },
  });
  if (duplicate) {
    if (duplicate.status === 'cancelled') {
      throw new FimPartnerError(409, 'externalId já usado');
    }
    if (duplicate.partyFundLink.party.cpfCnpj !== document) {
      throw new FimPartnerError(409, 'externalId já usado');
    }
    const view = await getFimShareholder(document);
    return redeemPayload(
      view,
      money(Number(duplicate.amount)),
      toYYYYMMDD(duplicate.settlesOn),
      input.dryRun,
    );
  }

  const party = await prisma.party.findFirst({
    where: { cpfCnpj: document, deletedAt: null },
    include: {
      cotista: true,
      partyFundLinks: { include: { fund: true } },
    },
  });
  if (!party?.cotista) throw new FimPartnerError(404, 'Posição FIM não encontrada');

  const links = party.partyFundLinks
    .filter((link) => link.quotaType === 'unica' && link.fund.modality === 'fim')
    .sort((a, b) => {
      const aStart = a.contractStartDate?.getTime() ?? a.linkedAt.getTime();
      const bStart = b.contractStartDate?.getTime() ?? b.linkedAt.getTime();
      return aStart - bStart;
    });
  const link = links[0];
  if (!link) throw new FimPartnerError(404, 'Posição FIM não encontrada');

  const viewBefore = await getFimShareholder(document);
  if (input.body.amountBrl > viewBefore.availableToRedeem + 1e-9) {
    throw new FimPartnerError(
      400,
      `amountBrl excede o saldo disponível (máx. ${viewBefore.availableToRedeem.toFixed(2)})`,
    );
  }

  if (input.dryRun) {
    return redeemPayload(
      {
        ...viewBefore,
        pendingRedemptionTotal: money(viewBefore.pendingRedemptionTotal + input.body.amountBrl),
        availableToRedeem: money(viewBefore.availableToRedeem - input.body.amountBrl),
        frozenAmount: money(viewBefore.frozenAmount + input.body.amountBrl),
        frozenUntil: settlesOn,
        yielding: money(viewBefore.balance - viewBefore.frozenAmount - input.body.amountBrl) > 0,
      },
      input.body.amountBrl,
      settlesOn,
      true,
    );
  }

  await prisma.fimRedemption.create({
    data: {
      partyFundLinkId: link.id,
      partnerId: input.partner.id,
      externalId: input.body.externalId,
      amount: input.body.amountBrl,
      requestedOn: parseYYYYMMDD(today),
      settlesOn: parseYYYYMMDD(settlesOn),
      status: 'pending',
    },
  });

  await backfillPartyFundLinkYields(link.id);

  const view = await getFimShareholder(document);
  const payload = redeemPayload(view, input.body.amountBrl, settlesOn);

  await logAudit({
    action: 'fim.redemption',
    entityType: 'cotista',
    entityId: party.cotista.id,
    details: {
      partnerId: input.partner.id,
      externalId: input.body.externalId,
      amountBrl: input.body.amountBrl,
      settlesOn,
      document,
    },
    ipAddress: input.ip ?? undefined,
  });

  try {
    await sendFimRedemptionNotice({
      name: party.legalName,
      document,
      amountBrl: input.body.amountBrl,
      totalContributed: payload.totalContributed,
      availableToRedeem: payload.availableToRedeem,
      settlesOn,
      frozenUntil: payload.frozenUntil ?? settlesOn,
      externalId: input.body.externalId,
      partnerName: input.partner.name,
    });
  } catch (err) {
    console.error('[fim.redemption] e-mail aos admins falhou:', err);
  }

  return payload;
}
