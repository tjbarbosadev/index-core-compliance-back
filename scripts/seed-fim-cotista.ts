/**
 * Cria (idempotente) fundo FIM + cotista PF com fimApplicationId via nextcorefim.
 * Uso: NODE_ENV=development npm run seed:fim-cotista
 *
 * Pré-requisito: nextcorefim rodando (ex. http://localhost:3002) com API_SERVICE_KEY alinhada.
 */
import { prisma } from '../src/db/index.js';
import { env } from '../src/lib/env.js';
import { ensureFimApplicationForParty } from '../src/lib/nextcorefim/fim-documents.js';

export const FIM_DEV_CNPJ = '68057459000246';
export const FIM_DEV_CPF = '52998224725';
export const FIM_DEV_EMAIL = 'cotista.fim.dev@opcore.local';
export const FIM_DEV_NAME = 'Cotista FIM Dev';

export async function ensureFimDevCotista() {
  const fund =
    (await prisma.fund.findUnique({ where: { cnpj: FIM_DEV_CNPJ } })) ??
    (await prisma.fund.create({
      data: {
        name: 'NEXT CORE II FIM (dev)',
        legalName: 'NEXT CORE II FUNDO DE INVESTIMENTO MULTIMERCADO (DEV)',
        cnpj: FIM_DEV_CNPJ,
        modality: 'fim',
        status: 'ativo',
        targetAudience: 'Investidores qualificados',
        inceptionDate: new Date('2025-01-01'),
        description: 'Fundo FIM de desenvolvimento para testes de documentos Mega.',
        regulatoryLimitsJson: {},
        extraInfoJson: { purpose: 'dev-docs-upload' },
      },
    }));

  const party = await prisma.party.upsert({
    where: { cpfCnpj: FIM_DEV_CPF },
    update: {
      legalName: FIM_DEV_NAME,
      status: 'aprovado',
      approvedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    create: {
      type: 'pf',
      cpfCnpj: FIM_DEV_CPF,
      legalName: FIM_DEV_NAME,
      status: 'aprovado',
      riskLevel: 'baixo',
      approvedAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.partyContact.deleteMany({ where: { partyId: party.id } });
  await prisma.partyContact.create({
    data: {
      partyId: party.id,
      email: FIM_DEV_EMAIL,
      phone: '+5511999990000',
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

  const existingLink = await prisma.partyFundLink.findFirst({
    where: { partyId: party.id, fundId: fund.id },
  });
  if (!existingLink) {
    await prisma.partyFundLink.create({
      data: {
        partyId: party.id,
        fundId: fund.id,
        quotaType: 'unica',
        quotaCount: 1,
        quotaAmount: 10_000,
        initialInvestment: 10_000,
        currentPrincipal: 10_000,
        contractStartDate: new Date('2025-06-01'),
      },
    });
  }

  const applicationId = await ensureFimApplicationForParty(party.id);
  const refreshed = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });

  return {
    fundId: fund.id,
    fundName: fund.name,
    partyId: party.id,
    cotistaId: cotista.id,
    applicationId: refreshed.fimApplicationId ?? applicationId,
  };
}

async function main() {
  console.log('\n=== Seed cotista FIM (Mega / nextcorefim) ===\n');
  console.log(`NEXTCOREFIM_API_URL=${env.nextcorefimApiUrl}`);

  const result = await ensureFimDevCotista();
  const webBase = env.webUrl.replace(/\/$/, '');

  console.log(`Fundo FIM: ${result.fundName} (${result.fundId})`);
  console.log('\n--- OK ---');
  console.log(`cotistaId:      ${result.cotistaId}`);
  console.log(`partyId:        ${result.partyId}`);
  console.log(`fimApplication: ${result.applicationId}`);
  console.log(`admin URL:      ${webBase}/cotistas/${result.cotistaId}`);
  console.log('');
}

const isMain =
  process.argv[1]?.includes('seed-fim-cotista') ||
  import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') ?? '');

if (isMain) {
  main()
    .catch((err) => {
      console.error('\nSeed FIM falhou:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
