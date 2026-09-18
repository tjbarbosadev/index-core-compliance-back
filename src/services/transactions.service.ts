import type { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../db/index.js';

export type ListTransactionsInput = {
  fundId?: string;
  partyId?: string;
  type?: TransactionType;
  limit?: number;
};

function mapTransaction(row: {
  id: string;
  fundId: string;
  type: TransactionType;
  counterpartyKind: string;
  partyId: string | null;
  amount: Prisma.Decimal;
  signedAmount: Prisma.Decimal;
  description: string | null;
  proofUri: string | null;
  status: string;
  occurredAt: Date;
  createdAt: Date;
}) {
  return {
    id: row.id,
    fundId: row.fundId,
    type: row.type,
    counterpartyKind: row.counterpartyKind,
    partyId: row.partyId ?? undefined,
    amount: Number(row.amount),
    signedAmount: Number(row.signedAmount),
    description: row.description ?? undefined,
    proofUri: row.proofUri ?? undefined,
    status: row.status,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTransactions(input: ListTransactionsInput = {}) {
  const limit = Math.min(input.limit ?? 200, 500);
  const rows = await prisma.fundTransaction.findMany({
    where: {
      fundId: input.fundId,
      partyId: input.partyId,
      type: input.type,
    },
    orderBy: { occurredAt: 'desc' },
    take: limit,
  });
  return rows.map(mapTransaction);
}
