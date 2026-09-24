/**
 * Smoke: POST /internal/proposals (requires PROPOSAL_INGEST_SERVICE_KEY + DB migrated).
 * Usage: NODE_ENV=development npx tsx scripts/smoke-site-proposal-ingest.ts
 */
import '../src/lib/load-env.js';
import { env } from '../src/lib/env.js';
import { prisma } from '../src/db/index.js';
import { softDeleteOnboarding, ingestSiteProposal } from '../src/services/onboarding.service.js';

const FIDC_CNPJ = '68057459000165';
const FIM_CNPJ = '67897391000160';
const TEST_CPF = '39053344705';

async function ensureFunds() {
  for (const [cnpj, data] of [
    [
      FIDC_CNPJ,
      {
        name: 'Next Core FIDC',
        modality: 'fidc' as const,
        legalName: 'NEXT CORE FIDC',
      },
    ],
    [
      FIM_CNPJ,
      {
        name: 'NEXT CORE II FIM',
        modality: 'fim' as const,
        legalName: 'NEXT CORE II FIM',
      },
    ],
  ] as const) {
    const existing = await prisma.fund.findUnique({ where: { cnpj } });
    if (!existing) {
      await prisma.fund.create({
        data: {
          cnpj,
          name: data.name,
          legalName: data.legalName,
          modality: data.modality,
          status: 'ativo',
          regulatoryLimitsJson: {},
        },
      });
      console.log(`created fund ${data.name}`);
    }
  }
}

async function main() {
  console.log('PROPOSAL_INGEST_SERVICE_KEY set?', Boolean(env.proposalIngestServiceKey));
  await ensureFunds();

  // Clean previous soft-deleted or active test party
  const existing = await prisma.party.findMany({ where: { cpfCnpj: TEST_CPF } });
  for (const p of existing) {
    if (!p.deletedAt) {
      const proc = await prisma.onboardingProcess.findFirst({
        where: { partyId: p.id, kind: 'cotista' },
        orderBy: { startedAt: 'desc' },
      });
      if (proc) {
        await softDeleteOnboarding(proc.id, 'cotista', '00000000-0000-4000-8000-000000000001');
        console.log('soft-deleted prior process', proc.id);
      }
    }
  }

  const fidc = await ingestSiteProposal({
    source: 'nexafidic',
    partyType: 'pf',
    cpfCnpj: TEST_CPF,
    legalName: 'Smoke FIDC PF',
    email: 'smoke.fidc@opcore.local',
    fundCnpj: FIDC_CNPJ,
    payload: { name: 'Smoke FIDC PF', cpf: TEST_CPF },
  });
  console.log('FIDC ingest', { created: fidc.created, id: fidc.process?.id });

  const again = await ingestSiteProposal({
    source: 'nexafidic',
    partyType: 'pf',
    cpfCnpj: TEST_CPF,
    legalName: 'Smoke FIDC PF Updated',
    email: 'smoke.fidc@opcore.local',
    fundCnpj: FIDC_CNPJ,
    payload: { name: 'Smoke FIDC PF Updated', cpf: TEST_CPF },
  });
  console.log('FIDC idempotent', { created: again.created, id: again.process?.id });

  if (fidc.process?.id) {
    await softDeleteOnboarding(fidc.process.id, 'cotista', '00000000-0000-4000-8000-000000000001');
    console.log('soft-deleted FIDC process — CPF free for FIM');
  }

  const fim = await ingestSiteProposal({
    source: 'nextcorefim',
    partyType: 'pf',
    cpfCnpj: TEST_CPF,
    legalName: 'Smoke FIM PF',
    email: 'smoke.fim@opcore.local',
    fundCnpj: FIM_CNPJ,
    externalApplicationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    quotaType: 'unica',
    payload: { name: 'Smoke FIM PF', cpf: TEST_CPF },
  });
  console.log('FIM ingest', {
    created: fim.created,
    id: fim.process?.id,
    fimApplicationId: fim.process?.fimApplicationId,
  });

  console.log('\nOK smoke-site-proposal-ingest');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
