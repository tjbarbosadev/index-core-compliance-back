import type { Party, Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** Active (non soft-deleted) party by CPF/CNPJ digits. */
export async function findActivePartyByCpfCnpj(
  cpfCnpj: string,
  tx?: Prisma.TransactionClient,
): Promise<Party | null> {
  const digits = digitsOnly(cpfCnpj);
  const db = tx ?? prisma;
  return db.party.findFirst({
    where: { cpfCnpj: digits, deletedAt: null },
  });
}

export const activePartyWhere: Prisma.PartyWhereInput = { deletedAt: null };
