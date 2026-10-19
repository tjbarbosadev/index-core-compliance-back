/**
 * Idempotent simulation cotista (excludeFromPl=true) for IndexCore app QA.
 *
 * Email: manager@indexcore.com.br
 * Senior I: R$ 10.000 from 2026-01-01 (10 quotas × R$ 1.000)
 * Senior II: R$ 100.000 from 2026-02-01 (100 quotas × R$ 1.000)
 *
 * Usage: NODE_ENV=development npx tsx scripts/seed-simulation-cotista.ts
 */
import { prisma } from '../src/db/index.js';
import { QUOTA_UNIT_BRL } from '../src/services/cotista.service.js';
import { backfillPartyFundLinkYields } from '../src/services/cotista-yield.service.js';
import { sumGlobalNetWorthFromLinks } from '../src/services/fund-pl.service.js';

export const SIM_EMAIL = 'manager@indexcore.com.br';
export const SIM_CPF = '11144477735';
export const SIM_NAME = 'Manager IndexCore (simulação)';

const POSITIONS = [
  {
    quotaType: 'senior_i' as const,
    quotaCount: 10,
    contractStartDate: new Date('2026-01-01'),
  },
  {
    quotaType: 'senior_ii' as const,
    quotaCount: 100,
    contractStartDate: new Date('2026-02-01'),
  },
];

async function resolveFundId(): Promise<{ id: string; name: string }> {
  const fim = await prisma.fund.findFirst({
    where: { status: 'ativo', modality: 'fim' },
    orderBy: { name: 'asc' },
  });
  if (fim) return { id: fim.id, name: fim.name };
  const any = await prisma.fund.findFirst({
    where: { status: 'ativo' },
    orderBy: { name: 'asc' },
  });
  if (!any) throw new Error('Nenhum fundo ativo encontrado');
  return { id: any.id, name: any.name };
}

export async function ensureSimulationCotista() {
  const fund = await resolveFundId();
  const plBefore = await sumGlobalNetWorthFromLinks();

  let party = await prisma.party.findFirst({
    where: { cpfCnpj: SIM_CPF, deletedAt: null },
  });

  if (!party) {
    const byEmail = await prisma.partyContact.findFirst({
      where: { email: SIM_EMAIL, party: { deletedAt: null } },
      include: { party: true },
    });
    party = byEmail?.party ?? null;
  }

  if (!party) {
    party = await prisma.party.create({
      data: {
        type: 'pf',
        cpfCnpj: SIM_CPF,
        legalName: SIM_NAME,
        status: 'aprovado',
        riskLevel: 'baixo',
        pepFlag: false,
        excludeFromPl: true,
        approvedAt: new Date(),
      },
    });
  } else {
    party = await prisma.party.update({
      where: { id: party.id },
      data: {
        legalName: SIM_NAME,
        status: 'aprovado',
        excludeFromPl: true,
        deletedAt: null,
        approvedAt: party.approvedAt ?? new Date(),
      },
    });
  }

  await prisma.partyContact.deleteMany({ where: { partyId: party.id } });
  await prisma.partyContact.create({
    data: {
      partyId: party.id,
      email: SIM_EMAIL,
      phone: null,
      isPrimary: true,
    },
  });

  const cotista = await prisma.cotista.upsert({
    where: { partyId: party.id },
    update: {},
    create: {
      partyId: party.id,
      investorProfile: 'moderado',
      suitabilityResult: 'moderado',
    },
  });

  for (const pos of POSITIONS) {
    const investment = pos.quotaCount * QUOTA_UNIT_BRL;
    const existing = await prisma.partyFundLink.findFirst({
      where: {
        partyId: party.id,
        fundId: fund.id,
        quotaType: pos.quotaType,
      },
    });
    if (existing) {
      await prisma.partyFundLink.update({
        where: { id: existing.id },
        data: {
          quotaCount: pos.quotaCount,
          quotaAmount: investment,
          initialInvestment: investment,
          currentPrincipal: investment,
          contractStartDate: pos.contractStartDate,
        },
      });
    } else {
      await prisma.partyFundLink.create({
        data: {
          partyId: party.id,
          fundId: fund.id,
          quotaType: pos.quotaType,
          quotaCount: pos.quotaCount,
          quotaAmount: investment,
          initialInvestment: investment,
          currentPrincipal: investment,
          contractStartDate: pos.contractStartDate,
        },
      });
    }
  }

  const links = await prisma.partyFundLink.findMany({
    where: { partyId: party.id, fundId: fund.id },
  });
  for (const link of links) {
    if (link.quotaType !== 'senior_i' && link.quotaType !== 'senior_ii') continue;
    if (!link.contractStartDate) continue;
    try {
      await backfillPartyFundLinkYields(link.id);
    } catch (err) {
      console.warn(`[sim] backfill falhou link=${link.id}:`, err);
    }
  }

  const plAfter = await sumGlobalNetWorthFromLinks();

  return {
    fundId: fund.id,
    fundName: fund.name,
    partyId: party.id,
    cotistaId: cotista.id,
    excludeFromPl: true,
    plBefore,
    plAfter,
    plDelta: plAfter - plBefore,
    positions: links.map((l) => ({
      id: l.id,
      quotaType: l.quotaType,
      quotaCount: l.quotaCount,
      investment: Number(l.initialInvestment),
      start: l.contractStartDate,
    })),
  };
}

async function main() {
  console.log('\n=== Seed cotista simulação (excludeFromPl) ===\n');
  const result = await ensureSimulationCotista();
  console.log(`Fundo: ${result.fundName} (${result.fundId})`);
  console.log(`cotistaId: ${result.cotistaId}`);
  console.log(`partyId:   ${result.partyId}`);
  console.log(`email:     ${SIM_EMAIL}`);
  console.log(`excludeFromPl: ${result.excludeFromPl}`);
  console.log(`PL before: ${result.plBefore.toFixed(2)}`);
  console.log(`PL after:  ${result.plAfter.toFixed(2)}`);
  console.log(`PL delta:  ${result.plDelta.toFixed(2)} (esperado ~0)`);
  for (const p of result.positions) {
    console.log(
      `  - ${p.quotaType}: ${p.quotaCount} cotas / R$ ${p.investment} desde ${p.start?.toISOString().slice(0, 10)}`,
    );
  }
  console.log('');
}

const isMain =
  process.argv[1]?.includes('seed-simulation-cotista') ||
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
