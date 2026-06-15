import type { FundModality, FundStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';
import { APP_ERROR, DEFAULT_REGULATORY_LIMITS } from '../lib/errors.js';
import { logAudit } from './audit.service.js';

export type CreateFundInput = {
  name: string;
  cnpj: string;
  cvmCode?: string;
  modality: FundModality;
  targetAudience?: string;
  status?: FundStatus;
  regulatoryLimitsJson?: Record<string, number>;
};

function mapFund(fund: {
  id: string;
  name: string;
  cnpj: string;
  cvmCode: string | null;
  modality: FundModality;
  targetAudience: string | null;
  status: FundStatus;
  regulatoryLimitsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  netWorthHistory?: { referenceDate: Date; netWorth: Prisma.Decimal }[];
}) {
  return {
    id: fund.id,
    name: fund.name,
    cnpj: fund.cnpj,
    cvmCode: fund.cvmCode ?? undefined,
    modality: fund.modality,
    targetAudience: fund.targetAudience ?? undefined,
    status: fund.status,
    regulatoryLimitsJson: (fund.regulatoryLimitsJson as Record<string, number>) ?? {},
    createdAt: fund.createdAt.toISOString(),
    updatedAt: fund.updatedAt.toISOString(),
    serviceProviders: [],
    netWorthHistory: (fund.netWorthHistory ?? []).map((h) => ({
      date: h.referenceDate.toISOString().slice(0, 10),
      netWorth: Number(h.netWorth),
    })),
    complianceStatus: 'conforme' as const,
  };
}

export async function listFunds(filters?: { status?: FundStatus; modality?: FundModality }) {
  const funds = await prisma.fund.findMany({
    where: {
      status: filters?.status,
      modality: filters?.modality,
    },
    include: { netWorthHistory: { orderBy: { referenceDate: 'desc' }, take: 5 } },
    orderBy: { name: 'asc' },
  });
  return funds.map(mapFund);
}

export async function getFundById(id: string) {
  const fund = await prisma.fund.findUnique({
    where: { id },
    include: { netWorthHistory: { orderBy: { referenceDate: 'desc' } } },
  });
  return fund ? mapFund(fund) : null;
}

export async function createFund(input: CreateFundInput, userId?: string, ip?: string) {
  const existing = await prisma.fund.findUnique({ where: { cnpj: input.cnpj } });
  if (existing) throw APP_ERROR.CONFLICT('CNPJ de fundo duplicado');

  const limits = input.regulatoryLimitsJson ?? DEFAULT_REGULATORY_LIMITS[input.modality] ?? {};

  const fund = await prisma.fund.create({
    data: {
      name: input.name,
      cnpj: input.cnpj,
      cvmCode: input.cvmCode,
      modality: input.modality,
      targetAudience: input.targetAudience,
      status: input.status ?? 'ativo',
      regulatoryLimitsJson: limits,
    },
    include: { netWorthHistory: true },
  });

  await logAudit({
    userId,
    action: 'funds.create',
    entityType: 'fund',
    entityId: fund.id,
    ipAddress: ip,
  });

  return mapFund(fund);
}

export async function updateFund(
  id: string,
  input: Partial<CreateFundInput>,
  userId?: string,
  ip?: string,
) {
  const fund = await prisma.fund.update({
    where: { id },
    data: {
      name: input.name,
      cnpj: input.cnpj,
      cvmCode: input.cvmCode,
      modality: input.modality,
      targetAudience: input.targetAudience,
      status: input.status,
      regulatoryLimitsJson: input.regulatoryLimitsJson,
    },
    include: { netWorthHistory: { orderBy: { referenceDate: 'desc' } } },
  });

  await logAudit({
    userId,
    action: 'funds.update',
    entityType: 'fund',
    entityId: fund.id,
    ipAddress: ip,
  });

  return mapFund(fund);
}
