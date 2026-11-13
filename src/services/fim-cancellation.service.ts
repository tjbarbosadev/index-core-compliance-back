import { prisma } from '../db/index.js';
import { logAudit } from './audit.service.js';
import { backfillPartyFundLinkYields } from './cotista-yield.service.js';
import { FimPartnerError, getFimShareholder } from './fim-subscription.service.js';

export type FimCancellationInput = {
  externalId: string;
  kind: 'subscription' | 'redemption';
};

export type FimCancelResponse = {
  kind: 'subscription' | 'redemption';
  externalId: string;
  result: 'cancelled';
  document: string;
  amountBrl: number;
  dryRun?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFimCancellation(
  body: unknown,
): { ok: true; input: FimCancellationInput } | { ok: false; message: string } {
  if (!isRecord(body)) return { ok: false, message: 'Corpo inválido' };
  const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : '';
  if (!externalId || externalId.length > 128) {
    return { ok: false, message: 'Informe externalId com até 128 caracteres' };
  }
  const kind = body.kind;
  if (kind !== 'subscription' && kind !== 'redemption') {
    return { ok: false, message: 'kind deve ser subscription ou redemption' };
  }
  return { ok: true, input: { externalId, kind } };
}

export async function cancelFim(input: {
  partner: { id: string; name: string };
  body: FimCancellationInput;
  ip?: string | null;
  dryRun?: boolean;
}): Promise<FimCancelResponse> {
  if (input.body.kind === 'subscription') {
    const row = await prisma.fimSubscription.findUnique({
      where: {
        partnerId_externalId: {
          partnerId: input.partner.id,
          externalId: input.body.externalId,
        },
      },
      include: { partyFundLink: { include: { party: true, fund: true } } },
    });
    if (!row) throw new FimPartnerError(404, 'Aplicação não encontrada');
    if (row.status === 'cancelled') {
      return {
        kind: 'subscription',
        externalId: row.externalId,
        result: 'cancelled',
        document: row.partyFundLink.party.cpfCnpj,
        amountBrl: Number(row.amount),
        ...(input.dryRun ? { dryRun: true } : {}),
      };
    }
    if (row.status !== 'pending') {
      throw new FimPartnerError(
        400,
        'Só é possível cancelar aplicação ainda pendente (antes de render)',
      );
    }
    if (input.dryRun) {
      return {
        kind: 'subscription',
        externalId: row.externalId,
        result: 'cancelled',
        document: row.partyFundLink.party.cpfCnpj,
        amountBrl: Number(row.amount),
        dryRun: true,
      };
    }
    await prisma.fimSubscription.update({
      where: { id: row.id },
      data: { status: 'cancelled' },
    });
    await backfillPartyFundLinkYields(row.partyFundLinkId);
    const cotista = await prisma.cotista.findUnique({
      where: { partyId: row.partyFundLink.partyId },
    });
    await logAudit({
      action: 'fim.cancellation',
      entityType: 'cotista',
      entityId: cotista?.id,
      details: {
        kind: 'subscription',
        partnerId: input.partner.id,
        externalId: row.externalId,
        amountBrl: Number(row.amount),
      },
      ipAddress: input.ip ?? undefined,
    });
    return {
      kind: 'subscription',
      externalId: row.externalId,
      result: 'cancelled',
      document: row.partyFundLink.party.cpfCnpj,
      amountBrl: Number(row.amount),
    };
  }

  const row = await prisma.fimRedemption.findUnique({
    where: {
      partnerId_externalId: {
        partnerId: input.partner.id,
        externalId: input.body.externalId,
      },
    },
    include: { partyFundLink: { include: { party: true } } },
  });
  if (!row) throw new FimPartnerError(404, 'Resgate não encontrado');
  if (row.status === 'cancelled') {
    return {
      kind: 'redemption',
      externalId: row.externalId,
      result: 'cancelled',
      document: row.partyFundLink.party.cpfCnpj,
      amountBrl: Number(row.amount),
      ...(input.dryRun ? { dryRun: true } : {}),
    };
  }
  if (row.status !== 'pending') {
    throw new FimPartnerError(400, 'Só é possível cancelar resgate ainda pendente');
  }
  if (input.dryRun) {
    return {
      kind: 'redemption',
      externalId: row.externalId,
      result: 'cancelled',
      document: row.partyFundLink.party.cpfCnpj,
      amountBrl: Number(row.amount),
      dryRun: true,
    };
  }
  await prisma.fimRedemption.update({
    where: { id: row.id },
    data: { status: 'cancelled' },
  });
  await backfillPartyFundLinkYields(row.partyFundLinkId);
  await getFimShareholder(row.partyFundLink.party.cpfCnpj).catch(() => null);
  const cotista = await prisma.cotista.findUnique({
    where: { partyId: row.partyFundLink.partyId },
  });
  await logAudit({
    action: 'fim.cancellation',
    entityType: 'cotista',
    entityId: cotista?.id,
    details: {
      kind: 'redemption',
      partnerId: input.partner.id,
      externalId: row.externalId,
      amountBrl: Number(row.amount),
    },
    ipAddress: input.ip ?? undefined,
  });
  return {
    kind: 'redemption',
    externalId: row.externalId,
    result: 'cancelled',
    document: row.partyFundLink.party.cpfCnpj,
    amountBrl: Number(row.amount),
  };
}
