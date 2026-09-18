import type { AssetClass, Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';
import { APP_ERROR } from '../lib/errors.js';
import { logAudit } from './audit.service.js';

export type CreateInvestidoInput = {
  fundId: string;
  assetClass: AssetClass;
  title: string;
  amount: number;
  justification: string;
  cedenteId?: string;
  acquisitionDocumentUri?: string;
  paymentProofUri?: string;
  acquiredAt: string;
};

function mapInvestment(row: {
  id: string;
  fundId: string;
  assetClass: AssetClass;
  title: string;
  amount: Prisma.Decimal;
  justification: string;
  cedenteId: string | null;
  acquisitionDocumentUri: string | null;
  paymentProofUri: string | null;
  status: string;
  acquiredAt: Date;
  createdAt: Date;
}) {
  return {
    id: row.id,
    fundId: row.fundId,
    assetClass: row.assetClass,
    title: row.title,
    amount: Number(row.amount),
    justification: row.justification,
    cedenteId: row.cedenteId ?? undefined,
    acquisitionDocumentUri: row.acquisitionDocumentUri ?? undefined,
    paymentProofUri: row.paymentProofUri ?? undefined,
    status: row.status,
    acquiredAt: row.acquiredAt.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listInvestidos(fundId?: string) {
  const rows = await prisma.fundInvestment.findMany({
    where: fundId ? { fundId } : undefined,
    orderBy: { acquiredAt: 'desc' },
    take: 500,
  });
  return rows.map(mapInvestment);
}

export async function createInvestido(input: CreateInvestidoInput, userId: string, ip?: string) {
  const justification = input.justification.trim();
  if (!justification) throw APP_ERROR.BAD_REQUEST('Justificativa é obrigatória');
  if (!(input.amount > 0)) throw APP_ERROR.BAD_REQUEST('Valor deve ser positivo');

  const fund = await prisma.fund.findUnique({ where: { id: input.fundId } });
  if (!fund) throw APP_ERROR.NOT_FOUND('Fundo');

  let cedentePartyId: string | null = null;
  if (input.assetClass === 'direito_creditorio') {
    if (!input.cedenteId) {
      throw APP_ERROR.BAD_REQUEST('Cedente obrigatório para direito creditório');
    }
    const cedente = await prisma.cedente.findUnique({
      where: { id: input.cedenteId },
      include: { party: true },
    });
    if (!cedente) throw APP_ERROR.NOT_FOUND('Cedente');
    if (cedente.party.status !== 'aprovado') {
      throw APP_ERROR.BAD_REQUEST('Cedente deve estar com cadastro aprovado');
    }
    cedentePartyId = cedente.partyId;
  }

  const acquiredAt = new Date(input.acquiredAt);
  const now = new Date();

  const investment = await prisma.$transaction(async (tx) => {
    const row = await tx.fundInvestment.create({
      data: {
        fundId: input.fundId,
        assetClass: input.assetClass,
        title: input.title.trim(),
        amount: input.amount,
        justification,
        cedenteId: input.cedenteId ?? null,
        acquisitionDocumentUri: input.acquisitionDocumentUri ?? null,
        paymentProofUri: input.paymentProofUri ?? null,
        status: 'aprovado',
        acquiredAt,
        createdById: userId,
      },
    });

    await tx.fundTransaction.create({
      data: {
        fundId: input.fundId,
        type: 'compra_ativo',
        counterpartyKind: cedentePartyId ? 'cedente' : 'outro',
        partyId: cedentePartyId,
        amount: input.amount,
        signedAmount: -input.amount,
        description: `Compra: ${input.title.trim()}`,
        proofUri: input.paymentProofUri ?? null,
        status: 'aprovado',
        occurredAt: now,
        createdById: userId,
      },
    });

    return row;
  });

  await logAudit({
    userId,
    action: 'investidos.create',
    entityType: 'fund_investment',
    entityId: investment.id,
    details: { fundId: input.fundId, assetClass: input.assetClass, amount: input.amount },
    ipAddress: ip,
  });

  return mapInvestment(investment);
}
