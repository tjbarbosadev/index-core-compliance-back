import type { FundModality, FundStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/index.js';
import { APP_ERROR, DEFAULT_REGULATORY_LIMITS } from '../lib/errors.js';
import { logAudit } from './audit.service.js';
import {
  balanceForPartyFundLink,
  netWorthByFundIds,
  sumFundNetWorthFromLinks,
} from './fund-pl.service.js';

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

export type FundBankAccountInput = {
  bankCode: string;
  bankName?: string;
  branch: string;
  account: string;
  accountType?: string;
  pixKey?: string;
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
  bankAccount?: {
    id: string;
    bankCode: string;
    bankName: string | null;
    branch: string;
    account: string;
    accountType: string;
    pixKey: string | null;
  } | null;
  currentNetWorth?: number;
  shareholders?: Array<{
    cotistaId?: string;
    partyId: string;
    legalName: string;
    cpfCnpj: string;
    quotaType: string;
    balance: number;
  }>;
};

function mapBankAccount(row: NonNullable<FundRow['bankAccount']>) {
  return {
    bankCode: row.bankCode,
    bankName: row.bankName ?? undefined,
    branch: row.branch,
    account: row.account,
    accountType: row.accountType,
    pixKey: row.pixKey ?? undefined,
  };
}

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
    bankAccount: fund.bankAccount ? mapBankAccount(fund.bankAccount) : undefined,
    currentNetWorth: fund.currentNetWorth,
    shareholders: fund.shareholders,
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

async function loadShareholders(fundId: string) {
  const links = await prisma.partyFundLink.findMany({
    where: { fundId },
    include: {
      party: { include: { cotista: { select: { id: true } } } },
      dailyYields: { orderBy: { referenceDate: 'desc' }, take: 1 },
    },
    orderBy: { linkedAt: 'asc' },
  });
  return links.map((link) => ({
    cotistaId: link.party.cotista?.id,
    partyId: link.partyId,
    legalName: link.party.legalName,
    cpfCnpj: link.party.cpfCnpj,
    quotaType: link.quotaType,
    balance: balanceForPartyFundLink(link),
  }));
}

export async function listFunds(filters?: { status?: FundStatus; modality?: FundModality }) {
  const funds = await prisma.fund.findMany({
    where: {
      status: filters?.status,
      modality: filters?.modality,
    },
    include: {
      netWorthHistory: { orderBy: { referenceDate: 'desc' }, take: 5 },
      bankAccount: true,
    },
    orderBy: { name: 'asc' },
  });
  const plMap = await netWorthByFundIds(funds.map((f) => f.id));
  return funds.map((fund) =>
    mapFund({
      ...fund,
      currentNetWorth: plMap.get(fund.id) ?? 0,
    }),
  );
}

export type PartnerQuotaClass = {
  name: string;
  targetYield?: string;
  termMonths?: number;
  amortization?: string;
  liquidity?: string;
  risk?: string;
};

export type PartnerFund = {
  id: string;
  name: string;
  legalName?: string;
  modality: FundModality;
  status: FundStatus;
  website?: string;
  description?: string;
  targetAudience?: string;
  inceptionDate?: string;
  quotaClasses: PartnerQuotaClass[];
};

/** Public partner catalog — no CNPJ, PL, bank, contacts, or shareholders. */
export function toPartnerFund(fund: {
  id: string;
  name: string;
  legalName?: string | null;
  modality: FundModality;
  status: FundStatus;
  website?: string | null;
  description?: string | null;
  targetAudience?: string | null;
  inceptionDate?: string | Date | null;
  extraInfoJson?: FundExtraInfo | null;
}): PartnerFund {
  const extra = fund.extraInfoJson ?? {};
  const rawClasses = Array.isArray(extra.quotaClasses) ? extra.quotaClasses : [];
  const quotaClasses: PartnerQuotaClass[] = rawClasses
    .filter((c): c is NonNullable<typeof c> => Boolean(c?.name))
    .map((c) => ({
      name: c.name,
      ...(c.targetYield ? { targetYield: c.targetYield } : {}),
      ...(c.termMonths != null ? { termMonths: c.termMonths } : {}),
      ...(c.amortization ? { amortization: c.amortization } : {}),
      ...(c.liquidity ? { liquidity: c.liquidity } : {}),
      ...(c.risk ? { risk: c.risk } : {}),
    }));

  let inceptionDate: string | undefined;
  if (fund.inceptionDate instanceof Date) {
    inceptionDate = fund.inceptionDate.toISOString().slice(0, 10);
  } else if (typeof fund.inceptionDate === 'string' && fund.inceptionDate.length > 0) {
    inceptionDate = fund.inceptionDate.slice(0, 10);
  }

  return {
    id: fund.id,
    name: fund.name,
    ...(fund.legalName ? { legalName: fund.legalName } : {}),
    modality: fund.modality,
    status: fund.status,
    ...(fund.website ? { website: fund.website } : {}),
    ...(fund.description ? { description: fund.description } : {}),
    ...(fund.targetAudience ? { targetAudience: fund.targetAudience } : {}),
    ...(inceptionDate ? { inceptionDate } : {}),
    quotaClasses,
  };
}

export async function listPartnerFunds(): Promise<PartnerFund[]> {
  const funds = await prisma.fund.findMany({
    where: { status: 'ativo' },
    orderBy: { name: 'asc' },
  });
  return funds.map((f) =>
    toPartnerFund({
      ...f,
      extraInfoJson: (f.extraInfoJson as FundExtraInfo) ?? {},
    }),
  );
}

export async function getPartnerFundById(id: string): Promise<PartnerFund | null> {
  const fund = await prisma.fund.findFirst({
    where: { id, status: 'ativo' },
  });
  if (!fund) return null;
  return toPartnerFund({
    ...fund,
    extraInfoJson: (fund.extraInfoJson as FundExtraInfo) ?? {},
  });
}

export async function getFundById(id: string) {
  const fund = await prisma.fund.findUnique({
    where: { id },
    include: {
      netWorthHistory: { orderBy: { referenceDate: 'desc' } },
      bankAccount: true,
    },
  });
  if (!fund) return null;
  const [currentNetWorth, shareholders] = await Promise.all([
    sumFundNetWorthFromLinks(id),
    loadShareholders(id),
  ]);
  return mapFund({ ...fund, currentNetWorth, shareholders });
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
    include: { netWorthHistory: true, bankAccount: true },
  });

  await logAudit({
    userId,
    action: 'funds.create',
    entityType: 'fund',
    entityId: fund.id,
    ipAddress: ip,
  });

  return mapFund({ ...fund, currentNetWorth: 0, shareholders: [] });
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
    include: {
      netWorthHistory: { orderBy: { referenceDate: 'desc' } },
      bankAccount: true,
    },
  });

  await logAudit({
    userId,
    action: 'funds.update',
    entityType: 'fund',
    entityId: fund.id,
    ipAddress: ip,
  });

  const currentNetWorth = await sumFundNetWorthFromLinks(id);
  return mapFund({ ...fund, currentNetWorth });
}

export async function upsertFundBankAccount(
  fundId: string,
  data: FundBankAccountInput,
  userId?: string,
  ip?: string,
) {
  const fund = await prisma.fund.findUnique({ where: { id: fundId } });
  if (!fund) throw APP_ERROR.NOT_FOUND('Fundo');

  const row = await prisma.fundBankAccount.upsert({
    where: { fundId },
    update: {
      bankCode: data.bankCode,
      bankName: data.bankName ?? null,
      branch: data.branch,
      account: data.account,
      accountType: data.accountType ?? 'corrente',
      pixKey: data.pixKey ?? null,
    },
    create: {
      fundId,
      bankCode: data.bankCode,
      bankName: data.bankName ?? null,
      branch: data.branch,
      account: data.account,
      accountType: data.accountType ?? 'corrente',
      pixKey: data.pixKey ?? null,
    },
  });

  await logAudit({
    userId,
    action: 'funds.bank_account.upsert',
    entityType: 'fund',
    entityId: fundId,
    ipAddress: ip,
  });

  return mapBankAccount(row);
}
