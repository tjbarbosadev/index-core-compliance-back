import { prisma } from '../db/index.js';
import { APP_ERROR } from '../lib/errors.js';
import { hasPermissionInList } from './permission.service.js';
import { logAudit } from './audit.service.js';
import { getVisualizationDate, parseYYYYMMDD, toYYYYMMDD } from './quota-calculator.js';
import {
  getYieldForDate,
  getLatestYieldOnOrBefore,
  listAmortizations,
  listYields,
  backfillPartyFundLinkYields,
} from './cotista-yield.service.js';

type GestorRow = {
  id: string;
  cpf_cnpj: string;
  legal_name: string;
  status: string;
  bank_code: string | null;
  branch: string | null;
  account: string | null;
};

const QUOTA_LABELS: Record<string, string> = {
  senior_i: 'Sênior I',
  senior_ii: 'Sênior II',
  senior: 'Sênior',
  mezanino: 'Mezanino',
  subordinada: 'Subordinada',
  unica: 'Única',
};

/** Valor unitário de cada cota (R$). */
export const QUOTA_UNIT_BRL = 10_000;

function mapYieldRow(y: {
  referenceDate: Date;
  selicPercent: { toString(): string } | number;
  selicFactor: { toString(): string } | number;
  selicSource: string;
  principal: { toString(): string } | number;
  yieldDay: { toString(): string } | number;
  yieldAccumulated: { toString(): string } | number;
  balanceTotal: { toString(): string } | number;
  hadWithdraw: boolean;
  withdrawAmount: { toString(): string } | number | null;
}) {
  return {
    referenceDate: toYYYYMMDD(y.referenceDate),
    selicPercent: Number(y.selicPercent),
    selicFactor: Number(y.selicFactor),
    selicSource: y.selicSource,
    principal: Number(y.principal),
    yieldDay: Number(y.yieldDay),
    yieldAccumulated: Number(y.yieldAccumulated),
    balanceTotal: Number(y.balanceTotal),
    hadWithdraw: y.hadWithdraw,
    withdrawAmount: y.withdrawAmount != null ? Number(y.withdrawAmount) : null,
  };
}

export async function mapCotistaFull(cotistaId: string) {
  const cotista = await prisma.cotista.findUnique({
    where: { id: cotistaId },
    include: {
      party: {
        include: {
          contacts: true,
          bankAccounts: true,
          documents: true,
          partyFundLinks: { include: { fund: true } },
        },
      },
    },
  });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');

  const links = [...cotista.party.partyFundLinks].sort(
    (a, b) => a.linkedAt.getTime() - b.linkedAt.getTime(),
  );
  const link = links[0];
  const primary =
    cotista.party.bankAccounts.find((b) => b.isPrimary) ?? cotista.party.bankAccounts[0];
  const contact = cotista.party.contacts.find((c) => c.isPrimary) ?? cotista.party.contacts[0];

  const vizDate = toYYYYMMDD(getVisualizationDate());
  let latestYield = null as ReturnType<typeof mapYieldRow> | null;
  let amortizations: Array<{
    id: string;
    partyFundLinkId: string;
    occurredOn: string;
    amount: number;
    kind: string;
    periodStart: string | null;
    periodEnd: string | null;
  }> = [];

  // Agrega saldo/rendimentos do dia útil anterior em todas as posições
  const perLinkYields = await Promise.all(
    links.map(async (l) => getLatestYieldOnOrBefore(l.id, vizDate)),
  );
  const present = perLinkYields.filter(Boolean) as NonNullable<(typeof perLinkYields)[number]>[];
  if (present.length > 0) {
    const first = mapYieldRow(present[0]!);
    latestYield = {
      ...first,
      referenceDate: toYYYYMMDD(
        present.reduce(
          (max, y) => (y.referenceDate > max ? y.referenceDate : max),
          present[0]!.referenceDate,
        ),
      ),
      principal: present.reduce((s, y) => s + Number(y.principal), 0),
      yieldDay: present.reduce((s, y) => s + Number(y.yieldDay), 0),
      yieldAccumulated: present.reduce((s, y) => s + Number(y.yieldAccumulated), 0),
      balanceTotal: present.reduce((s, y) => s + Number(y.balanceTotal), 0),
      hadWithdraw: present.some((y) => y.hadWithdraw),
      withdrawAmount:
        present.reduce(
          (s, y) => s + (y.withdrawAmount != null ? Number(y.withdrawAmount) : 0),
          0,
        ) || null,
    };
  }

  const amortNested = await Promise.all(links.map((l) => listAmortizations(l.id)));
  amortizations = amortNested
    .flat()
    .map((a) => ({
      id: a.id,
      partyFundLinkId: a.partyFundLinkId,
      occurredOn: toYYYYMMDD(a.occurredOn),
      amount: Number(a.amount),
      kind: a.kind,
      periodStart: a.periodStart ? toYYYYMMDD(a.periodStart) : null,
      periodEnd: a.periodEnd ? toYYYYMMDD(a.periodEnd) : null,
    }))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));

  const positions = await Promise.all(
    links.map(async (l) => {
      const y = await getLatestYieldOnOrBefore(l.id, vizDate);
      return {
        id: l.id,
        fundId: l.fundId,
        fundName: l.fund.name,
        quotaType: l.quotaType,
        quotaTypeLabel: QUOTA_LABELS[l.quotaType] ?? l.quotaType,
        quotaCount: l.quotaCount,
        initialInvestment: Number(l.initialInvestment),
        contractStartDate: l.contractStartDate ? toYYYYMMDD(l.contractStartDate) : null,
        contractEndDate: l.contractEndDate ? toYYYYMMDD(l.contractEndDate) : null,
        latestYield: y ? mapYieldRow(y) : null,
      };
    }),
  );

  const totalQuotaCount = links.reduce((s, l) => s + l.quotaCount, 0);
  const totalInvestment = links.reduce((s, l) => s + Number(l.initialInvestment), 0);

  return {
    id: cotista.id,
    legalName: cotista.party.legalName,
    cpfCnpj: cotista.party.cpfCnpj,
    status: cotista.party.status,
    type: cotista.party.type,
    riskLevel: cotista.party.riskLevel,
    pepFlag: cotista.party.pepFlag,
    expiresAt: cotista.party.expiresAt?.toISOString() ?? null,
    fundId: link?.fundId ?? '',
    fundName: link?.fund.name ?? '',
    quotaType: link?.quotaType ?? null,
    quotaTypeLabel: link ? (QUOTA_LABELS[link.quotaType] ?? link.quotaType) : null,
    quotaCount: totalQuotaCount,
    initialInvestment: totalInvestment,
    contractStartDate: link?.contractStartDate ? toYYYYMMDD(link.contractStartDate) : null,
    contractEndDate: link?.contractEndDate ? toYYYYMMDD(link.contractEndDate) : null,
    partyFundLinkId: link?.id ?? null,
    positions,
    visualizationDate: vizDate,
    latestYield,
    yieldHistory: [] as ReturnType<typeof mapYieldRow>[],
    amortizations,
    investorProfile: cotista.investorProfile ?? undefined,
    email: contact?.email ?? undefined,
    phone: contact?.phone ?? undefined,
    address: contact?.addressJson ? JSON.stringify(contact.addressJson) : undefined,
    bankCode: primary?.bankCode,
    branch: primary?.branch,
    account: primary?.account,
    bankAccounts: cotista.party.bankAccounts.map((b) => ({
      bankCode: b.bankCode,
      branch: b.branch,
      account: b.account,
      isPrimary: b.isPrimary,
    })),
    documents: cotista.party.documents.map((d) => ({
      id: d.id,
      type: d.type,
      fileName: d.fileName,
      status: d.status,
    })),
    onboardingHistory: [],
  };
}

export function mapRestricted(row: GestorRow) {
  return {
    id: row.id,
    legalName: row.legal_name,
    cpfCnpj: row.cpf_cnpj,
    status: row.status,
    bankCode: row.bank_code ?? undefined,
    branch: row.branch ?? undefined,
    account: row.account ?? undefined,
  };
}

async function listGestorRestricted(): Promise<GestorRow[]> {
  return prisma.$queryRaw<GestorRow[]>`
    SELECT
      c.id,
      p.cpf_cnpj,
      p.legal_name,
      p.status,
      pba.bank_code,
      pba.branch,
      pba.account
    FROM parties p
    JOIN cotistas c ON c.party_id = p.id
    LEFT JOIN party_bank_accounts pba ON pba.party_id = p.id AND pba.is_primary = TRUE
    WHERE p.status = 'aprovado'
      AND (p.expires_at IS NULL OR p.expires_at > NOW())
    ORDER BY p.legal_name ASC
  `;
}

export async function listCotistas(permissions: string[], isAdmin: boolean, status?: string) {
  const canViewKyc = hasPermissionInList(permissions, 'cotistas.view_kyc', isAdmin);

  if (!canViewKyc) {
    const rows = await listGestorRestricted();
    return rows.map(mapRestricted);
  }

  const cotistas = await prisma.cotista.findMany({
    where: status && status !== 'all' ? { party: { status: status as 'aprovado' } } : undefined,
    include: {
      party: {
        include: {
          bankAccounts: true,
          partyFundLinks: { include: { fund: true } },
        },
      },
    },
    orderBy: { party: { legalName: 'asc' } },
  });

  return Promise.all(cotistas.map((c) => mapCotistaFull(c.id)));
}

export async function getCotistaById(id: string, permissions: string[], isAdmin: boolean) {
  const canViewKyc = hasPermissionInList(permissions, 'cotistas.view_kyc', isAdmin);

  if (!canViewKyc) {
    const rows = await listGestorRestricted();
    const row = rows.find((r) => r.id === id);
    return row ? mapRestricted(row) : null;
  }

  const exists = await prisma.cotista.findUnique({ where: { id } });
  if (!exists) return null;
  return mapCotistaFull(id);
}

function monthBounds(yearMonth: string): { from: string; to: string } {
  const [ys, ms] = yearMonth.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m || m < 1 || m > 12) throw APP_ERROR.BAD_REQUEST('Mês inválido');
  const from = `${ys}-${ms!.padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0, 12));
  return { from, to: toYYYYMMDD(last) };
}

function minDateStr(...dates: string[]): string {
  return dates.reduce((a, b) => (a < b ? a : b));
}

function maxDateStr(...dates: string[]): string {
  return dates.reduce((a, b) => (a > b ? a : b));
}

function aggregateYieldRows(
  rows: Array<Parameters<typeof mapYieldRow>[0] & { referenceDate: Date }>,
): ReturnType<typeof mapYieldRow>[] {
  const byDate = new Map<string, ReturnType<typeof mapYieldRow>>();
  for (const row of rows) {
    const mapped = mapYieldRow(row);
    const existing = byDate.get(mapped.referenceDate);
    if (!existing) {
      byDate.set(mapped.referenceDate, mapped);
      continue;
    }
    byDate.set(mapped.referenceDate, {
      ...existing,
      principal: existing.principal + mapped.principal,
      yieldDay: existing.yieldDay + mapped.yieldDay,
      yieldAccumulated: existing.yieldAccumulated + mapped.yieldAccumulated,
      balanceTotal: existing.balanceTotal + mapped.balanceTotal,
      hadWithdraw: existing.hadWithdraw || mapped.hadWithdraw,
      withdrawAmount: (existing.withdrawAmount ?? 0) + (mapped.withdrawAmount ?? 0) || null,
    });
  }
  return [...byDate.values()].sort((a, b) => b.referenceDate.localeCompare(a.referenceDate));
}

export async function getCotistaYields(
  cotistaId: string,
  opts?: { date?: string; yearMonth?: string; limit?: number; partyFundLinkId?: string },
) {
  const vizDate = toYYYYMMDD(getVisualizationDate());
  const cotista = await prisma.cotista.findUnique({
    where: { id: cotistaId },
    include: { party: { include: { partyFundLinks: true } } },
  });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');
  const links = opts?.partyFundLinkId
    ? cotista.party.partyFundLinks.filter((l) => l.id === opts.partyFundLinkId)
    : cotista.party.partyFundLinks;
  if (links.length === 0)
    return { visualizationDate: vizDate, yearMonth: opts?.yearMonth ?? null, items: [] };

  if (opts?.date) {
    const perLink = await Promise.all(links.map((l) => getYieldForDate(l.id, opts.date!)));
    const present = perLink.filter(Boolean) as NonNullable<(typeof perLink)[number]>[];
    return {
      visualizationDate: opts.date,
      yearMonth: opts.date.slice(0, 7),
      items: aggregateYieldRows(present),
    };
  }

  if (opts?.yearMonth) {
    const bounds = monthBounds(opts.yearMonth);
    const starts = links
      .map((l) => (l.contractStartDate ? toYYYYMMDD(l.contractStartDate) : null))
      .filter((d): d is string => Boolean(d));
    const ends = links
      .map((l) => (l.contractEndDate ? toYYYYMMDD(l.contractEndDate) : null))
      .filter((d): d is string => Boolean(d));

    const contractStart = starts.length > 0 ? minDateStr(...starts) : bounds.from;
    const contractEnd = ends.length > 0 ? maxDateStr(...ends) : vizDate;
    const endCap = minDateStr(contractEnd, vizDate);
    const from = maxDateStr(bounds.from, contractStart);
    const to = minDateStr(bounds.to, endCap);

    if (from > to) {
      return { visualizationDate: vizDate, yearMonth: opts.yearMonth, items: [] };
    }

    const nested = await Promise.all(links.map((l) => listYields(l.id, { from, to, limit: 31 })));
    return {
      visualizationDate: vizDate,
      yearMonth: opts.yearMonth,
      items: aggregateYieldRows(nested.flat()),
    };
  }

  const hist = await Promise.all(links.map((l) => listYields(l.id, { limit: opts?.limit ?? 90 })));
  return {
    visualizationDate: vizDate,
    yearMonth: null,
    items: aggregateYieldRows(hist.flat()),
  };
}

export async function getCotistaAmortizations(cotistaId: string, partyFundLinkId?: string) {
  const cotista = await prisma.cotista.findUnique({
    where: { id: cotistaId },
    include: { party: { include: { partyFundLinks: true } } },
  });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');
  const links = partyFundLinkId
    ? cotista.party.partyFundLinks.filter((l) => l.id === partyFundLinkId)
    : cotista.party.partyFundLinks;
  if (links.length === 0) return [];
  const nested = await Promise.all(links.map((l) => listAmortizations(l.id)));
  return nested
    .flat()
    .map((a) => ({
      id: a.id,
      partyFundLinkId: a.partyFundLinkId,
      occurredOn: toYYYYMMDD(a.occurredOn),
      amount: Number(a.amount),
      kind: a.kind,
      periodStart: a.periodStart ? toYYYYMMDD(a.periodStart) : null,
      periodEnd: a.periodEnd ? toYYYYMMDD(a.periodEnd) : null,
    }))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
}

export async function approveCotista(id: string, expiresAt: string, userId: string, ip?: string) {
  const cotista = await prisma.cotista.findUnique({ where: { id }, include: { party: true } });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');

  await prisma.party.update({
    where: { id: cotista.partyId },
    data: {
      status: 'aprovado',
      expiresAt: new Date(expiresAt),
      approvedAt: new Date(),
      approvedBy: userId,
    },
  });

  await logAudit({
    userId,
    action: 'cotista.approve',
    entityType: 'cotista',
    entityId: id,
    result: 'sucesso',
    ipAddress: ip,
  });

  return mapCotistaFull(id);
}

export async function rejectCotista(id: string, reason: string, userId: string, ip?: string) {
  const cotista = await prisma.cotista.findUnique({ where: { id }, include: { party: true } });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');

  await prisma.party.update({
    where: { id: cotista.partyId },
    data: { status: 'rejeitado' },
  });

  await logAudit({
    userId,
    action: 'cotista.reject',
    entityType: 'cotista',
    entityId: id,
    result: 'sucesso',
    details: { reason },
    ipAddress: ip,
  });

  return mapCotistaFull(id);
}

export type CotistaWriteInput = {
  legalName: string;
  cpfCnpj: string;
  email?: string;
  phone?: string;
  positions: Array<{
    id?: string;
    fundId: string;
    quotaType: 'senior_i' | 'senior_ii';
    quotaCount: number;
    contractStartDate?: string | null;
    contractEndDate?: string | null;
  }>;
};

function normalizeDocument(cpfCnpj: string): string {
  return cpfCnpj.replace(/\D/g, '');
}

function partyTypeFromDocument(digits: string): 'pf' | 'pj' {
  return digits.length <= 11 ? 'pf' : 'pj';
}

function validatePositions(positions: CotistaWriteInput['positions']): Array<{
  id?: string;
  fundId: string;
  quotaType: 'senior_i' | 'senior_ii';
  quotaCount: number;
  investment: number;
  contractStartDate: Date | null;
  contractEndDate: Date | null;
}> {
  if (!positions.length) throw APP_ERROR.BAD_REQUEST('Informe ao menos uma posição');
  return positions.map((p) => {
    const quotaCount = Math.max(0, Math.floor(Number(p.quotaCount) || 0));
    if (quotaCount < 1) throw APP_ERROR.BAD_REQUEST('Quantidade de cotas deve ser pelo menos 1');
    return {
      id: p.id,
      fundId: p.fundId,
      quotaType: p.quotaType,
      quotaCount,
      investment: quotaCount * QUOTA_UNIT_BRL,
      contractStartDate: p.contractStartDate ? parseYYYYMMDD(p.contractStartDate) : null,
      contractEndDate: p.contractEndDate ? parseYYYYMMDD(p.contractEndDate) : null,
    };
  });
}

async function backfillYieldsForCotista(cotistaId: string): Promise<void> {
  const cotista = await prisma.cotista.findUnique({
    where: { id: cotistaId },
    include: { party: { include: { partyFundLinks: true } } },
  });
  if (!cotista) return;

  for (const link of cotista.party.partyFundLinks) {
    if (!link.contractStartDate) continue;
    if (link.quotaType !== 'senior_i' && link.quotaType !== 'senior_ii') continue;
    try {
      await backfillPartyFundLinkYields(link.id);
    } catch (err) {
      console.warn(`[cotista] backfill de rendimentos falhou link=${link.id}:`, err);
    }
  }
}

export async function createCotista(input: CotistaWriteInput, userId: string, ip?: string) {
  const digits = normalizeDocument(input.cpfCnpj);
  if (digits.length < 11) throw APP_ERROR.BAD_REQUEST('CPF/CNPJ inválido');
  const legalName = input.legalName.trim();
  if (!legalName) throw APP_ERROR.BAD_REQUEST('Nome obrigatório');

  const positions = validatePositions(input.positions);
  for (const p of positions) {
    const fund = await prisma.fund.findUnique({ where: { id: p.fundId } });
    if (!fund) throw APP_ERROR.NOT_FOUND('Fundo');
  }

  const existing = await prisma.party.findUnique({ where: { cpfCnpj: digits } });
  if (existing) throw APP_ERROR.CONFLICT('Já existe cadastro com este CPF/CNPJ');

  const createdId = await prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        type: partyTypeFromDocument(digits),
        cpfCnpj: digits,
        legalName,
        status: 'aprovado',
        riskLevel: 'baixo',
        pepFlag: false,
        approvedAt: new Date(),
        approvedBy: userId,
      },
    });

    const row = await tx.cotista.create({
      data: { partyId: party.id },
    });

    if (input.email || input.phone) {
      await tx.partyContact.create({
        data: {
          partyId: party.id,
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          isPrimary: true,
        },
      });
    }

    for (const p of positions) {
      await tx.partyFundLink.create({
        data: {
          partyId: party.id,
          fundId: p.fundId,
          quotaType: p.quotaType,
          initialInvestment: p.investment,
          currentPrincipal: p.investment,
          quotaCount: p.quotaCount,
          quotaAmount: p.investment,
          contractStartDate: p.contractStartDate,
          contractEndDate: p.contractEndDate,
        },
      });
    }

    return row.id;
  });

  await logAudit({
    userId,
    action: 'cotista.create',
    entityType: 'cotista',
    entityId: createdId,
    result: 'sucesso',
    ipAddress: ip,
  });

  await backfillYieldsForCotista(createdId);

  return mapCotistaFull(createdId);
}

export async function updateCotista(
  id: string,
  input: CotistaWriteInput,
  userId: string,
  ip?: string,
) {
  const cotista = await prisma.cotista.findUnique({
    where: { id },
    include: {
      party: { include: { contacts: true, partyFundLinks: true } },
    },
  });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');

  const digits = normalizeDocument(input.cpfCnpj);
  if (digits.length < 11) throw APP_ERROR.BAD_REQUEST('CPF/CNPJ inválido');
  const legalName = input.legalName.trim();
  if (!legalName) throw APP_ERROR.BAD_REQUEST('Nome obrigatório');

  const positions = validatePositions(input.positions);
  for (const p of positions) {
    const fund = await prisma.fund.findUnique({ where: { id: p.fundId } });
    if (!fund) throw APP_ERROR.NOT_FOUND('Fundo');
    if (p.id) {
      const owned = cotista.party.partyFundLinks.some((l) => l.id === p.id);
      if (!owned) throw APP_ERROR.BAD_REQUEST('Posição inválida para este cotista');
    }
  }

  if (digits !== cotista.party.cpfCnpj) {
    const clash = await prisma.party.findUnique({ where: { cpfCnpj: digits } });
    if (clash) throw APP_ERROR.CONFLICT('Já existe cadastro com este CPF/CNPJ');
  }

  const contact = cotista.party.contacts.find((c) => c.isPrimary) ?? cotista.party.contacts[0];
  const keepIds = new Set(positions.map((p) => p.id).filter((x): x is string => Boolean(x)));

  await prisma.$transaction(async (tx) => {
    await tx.party.update({
      where: { id: cotista.partyId },
      data: {
        legalName,
        cpfCnpj: digits,
        type: partyTypeFromDocument(digits),
      },
    });

    if (contact) {
      await tx.partyContact.update({
        where: { id: contact.id },
        data: {
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
        },
      });
    } else if (input.email || input.phone) {
      await tx.partyContact.create({
        data: {
          partyId: cotista.partyId,
          email: input.email?.trim() || null,
          phone: input.phone?.trim() || null,
          isPrimary: true,
        },
      });
    }

    const toRemove = cotista.party.partyFundLinks.filter((l) => !keepIds.has(l.id));
    for (const l of toRemove) {
      await tx.partyFundLink.delete({ where: { id: l.id } });
    }

    for (const p of positions) {
      if (p.id) {
        await tx.partyFundLink.update({
          where: { id: p.id },
          data: {
            fundId: p.fundId,
            quotaType: p.quotaType,
            initialInvestment: p.investment,
            currentPrincipal: p.investment,
            quotaCount: p.quotaCount,
            quotaAmount: p.investment,
            contractStartDate: p.contractStartDate,
            contractEndDate: p.contractEndDate,
          },
        });
      } else {
        await tx.partyFundLink.create({
          data: {
            partyId: cotista.partyId,
            fundId: p.fundId,
            quotaType: p.quotaType,
            initialInvestment: p.investment,
            currentPrincipal: p.investment,
            quotaCount: p.quotaCount,
            quotaAmount: p.investment,
            contractStartDate: p.contractStartDate,
            contractEndDate: p.contractEndDate,
          },
        });
      }
    }
  });

  await logAudit({
    userId,
    action: 'cotista.update',
    entityType: 'cotista',
    entityId: id,
    result: 'sucesso',
    ipAddress: ip,
  });

  await backfillYieldsForCotista(id);

  return mapCotistaFull(id);
}
