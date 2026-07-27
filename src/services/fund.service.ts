import type { FundModality, FundStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';
import { APP_ERROR, DEFAULT_REGULATORY_LIMITS } from '../lib/errors.js';
import { logAudit } from './audit.service.js';

export type FundExtraInfo = {
  regulator?: string;
  isin?: string;
  anbimaCode?: string;
  benchmark?: string;
  fees?: { administrationPctAa?: number; performancePctAa?: number };
  documents?: { regulamentoUrl?: string; laminaUrl?: string };
  quotaClasses?: Array<{
    name: string;
    targetYield?: string;
    termMonths?: number;
    amortization?: string;
    liquidity?: string;
    risk?: string;
    minAmount?: number;
  }>;
  [key: string]: unknown;
};

export type CreateFundInput = {
  name: string;
  legalName?: string;
  cnpj: string;
  cvmCode?: string;
  modality: FundModality;
  targetAudience?: string;
  status?: FundStatus;
  inceptionDate?: string;
  website?: string;
  registeredAddress?: string;
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
  regulatoryLimitsJson?: Record<string, number>;
  extraInfoJson?: FundExtraInfo;
};

type FundRow = {
  id: string;
  name: string;
  legalName: string | null;
  cnpj: string;
  cvmCode: string | null;
  modality: FundModality;
  targetAudience: string | null;
  status: FundStatus;
  inceptionDate: Date | null;
  website: string | null;
  registeredAddress: string | null;
  description: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  regulatoryLimitsJson: unknown;
  extraInfoJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  netWorthHistory?: { referenceDate: Date; netWorth: Prisma.Decimal }[];
};

function mapFund(fund: FundRow) {
  return {
    id: fund.id,
    name: fund.name,
    legalName: fund.legalName ?? undefined,
    cnpj: fund.cnpj,
    cvmCode: fund.cvmCode ?? undefined,
    modality: fund.modality,
    targetAudience: fund.targetAudience ?? undefined,
    status: fund.status,
    inceptionDate: fund.inceptionDate ? fund.inceptionDate.toISOString().slice(0, 10) : undefined,
    website: fund.website ?? undefined,
    registeredAddress: fund.registeredAddress ?? undefined,
    description: fund.description ?? undefined,
    contactEmail: fund.contactEmail ?? undefined,
    contactPhone: fund.contactPhone ?? undefined,
    regulatoryLimitsJson: (fund.regulatoryLimitsJson as Record<string, number>) ?? {},
    extraInfoJson: (fund.extraInfoJson as FundExtraInfo) ?? {},
    createdAt: fund.createdAt.toISOString(),
    updatedAt: fund.updatedAt.toISOString(),
    serviceProviders: [] as { id: string; providerName: string; role: string }[],
    netWorthHistory: (fund.netWorthHistory ?? []).map((h) => ({
      date: h.referenceDate.toISOString().slice(0, 10),
      netWorth: Number(h.netWorth),
    })),
    complianceStatus: 'conforme' as const,
  };
}

function toFundData(input: Partial<CreateFundInput>): Prisma.FundUpdateInput {
  const data: Prisma.FundUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.legalName !== undefined) data.legalName = input.legalName || null;
  if (input.cnpj !== undefined) data.cnpj = input.cnpj;
  if (input.cvmCode !== undefined) data.cvmCode = input.cvmCode || null;
  if (input.modality !== undefined) data.modality = input.modality;
  if (input.targetAudience !== undefined) data.targetAudience = input.targetAudience || null;
  if (input.status !== undefined) data.status = input.status;
  if (input.inceptionDate !== undefined) {
    data.inceptionDate = input.inceptionDate ? new Date(input.inceptionDate) : null;
  }
  if (input.website !== undefined) data.website = input.website || null;
  if (input.registeredAddress !== undefined) {
    data.registeredAddress = input.registeredAddress || null;
  }
  if (input.description !== undefined) data.description = input.description || null;
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail || null;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone || null;
  if (input.regulatoryLimitsJson !== undefined) {
    data.regulatoryLimitsJson = input.regulatoryLimitsJson;
  }
  if (input.extraInfoJson !== undefined) {
    data.extraInfoJson = input.extraInfoJson as Prisma.InputJsonValue;
  }
  return data;
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
      legalName: input.legalName,
      cnpj: input.cnpj,
      cvmCode: input.cvmCode,
      modality: input.modality,
      targetAudience: input.targetAudience,
      status: input.status ?? 'ativo',
      inceptionDate: input.inceptionDate ? new Date(input.inceptionDate) : undefined,
      website: input.website,
      registeredAddress: input.registeredAddress,
      description: input.description,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      regulatoryLimitsJson: limits,
      extraInfoJson: (input.extraInfoJson ?? {}) as Prisma.InputJsonValue,
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
    data: toFundData(input),
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
