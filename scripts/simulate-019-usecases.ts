/**
 * Simulação E2E local dos use cases do plano 019 (admin OpCore).
 * Uso: NODE_ENV=development tsx scripts/simulate-019-usecases.ts
 */
import { prisma } from '../src/db/index.js';
import { getSummary } from '../src/services/dashboard.service.js';
import {
  getFundById,
  listFunds,
  updateFund,
  upsertFundBankAccount,
} from '../src/services/fund.service.js';
import {
  approveOnboarding,
  confirmDeposit,
  createOnboarding,
  advanceOnboardingStep,
} from '../src/services/onboarding.service.js';
import { upsertCotistaBankAccount, listCotistas } from '../src/services/cotista.service.js';
import { createInvestido, listInvestidos } from '../src/services/investidos.service.js';
import { listTransactions } from '../src/services/transactions.service.js';
import { generateReport } from '../src/services/reports.service.js';
import { computeFundComplianceStatus } from '../src/services/compliance-fund.service.js';
import { maybeAlertFragmentedAportes } from '../src/services/transaction-alerts.service.js';
import { resolveUserPermissions } from '../src/services/permission.service.js';

type Check = { name: string; ok: boolean; detail?: string };

const results: Check[] = [];

function assert(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Assertion failed: ${name}${detail ? ` — ${detail}` : ''}`);
}

async function advanceToStep6(processId: string, kind: 'cotista' | 'cedente', userId: string) {
  for (let i = 0; i < 5; i++) {
    await advanceOnboardingStep(
      processId,
      kind,
      {
        advance: true,
        suitabilityAnswers: { q1: 1 },
        suitabilityProfile: 'moderado',
        kyc: { pepFlag: false, restrictiveListHit: false },
        aml: { lawfulOriginDeclared: true },
        ...(kind === 'cedente'
          ? {
              beneficialOwners: [
                {
                  ownerName: 'Sócio Teste',
                  ownerCpfCnpj: '11144477735',
                  ownershipPct: 100,
                  pepFlag: false,
                },
              ],
            }
          : {}),
      },
      userId,
    );
  }
  await prisma.onboardingProcess.update({
    where: { id: processId },
    data: { currentStep: 6 },
  });
  await prisma.onboardingStep.updateMany({
    where: { processId },
    data: { status: 'concluido', completedAt: new Date() },
  });
}

async function main() {
  console.log('\n=== Simulação use cases 019 — Admin OpCore ===\n');

  const complianceUser = await prisma.user.findFirst({
    where: { email: { in: ['compliance.director@indexcore.local', 'compliance@indexcore.local'] } },
  });
  const gestaoUser = await prisma.user.findUnique({ where: { email: 'gestao@indexcore.local' } });
  const adminUser = await prisma.user.findFirst({ where: { isAdmin: true } });
  assert('seed: compliance_director user', !!complianceUser, complianceUser?.email);
  assert('seed: gestão user', !!gestaoUser);
  assert('seed: admin user', !!adminUser);

  const compliancePerms = await resolveUserPermissions(complianceUser!.id);
  const gestaoPerms = await resolveUserPermissions(gestaoUser!.id);
  assert(
    'ACL: compliance_director tem onboarding.approve',
    compliancePerms.includes('onboarding.approve'),
  );
  assert(
    'ACL: compliance_director NÃO tem transactions.approve',
    !compliancePerms.includes('transactions.approve'),
  );
  assert('ACL: gestão tem transactions.approve', gestaoPerms.includes('transactions.approve'));
  assert('ACL: gestão tem investidos.write', gestaoPerms.includes('investidos.write'));

  // --- Dashboard ---
  const summaryBefore = await getSummary();
  assert(
    'Dashboard: activeFunds > 0',
    summaryBefore.activeFunds > 0,
    String(summaryBefore.activeFunds),
  );
  assert(
    'Dashboard: PL consolidado numérico',
    Number.isFinite(summaryBefore.totalNetWorth),
    String(summaryBefore.totalNetWorth),
  );
  assert(
    'Dashboard: cotistas aprovados >= 0',
    summaryBefore.approvedShareholders >= 0,
    String(summaryBefore.approvedShareholders),
  );

  // --- Fundos ---
  const funds = await listFunds();
  assert('Fundos: listagem não vazia', funds.length > 0, String(funds.length));
  const fund = await getFundById(funds[0]!.id);
  assert(
    'Fundos: getById com currentNetWorth',
    fund != null && typeof fund.currentNetWorth === 'number',
  );
  assert('Fundos: shareholders array', Array.isArray(fund!.shareholders));

  await upsertFundBankAccount(
    fund!.id,
    {
      bankCode: '341',
      bankName: 'Itaú',
      branch: '0001',
      account: '12345-6',
      accountType: 'corrente',
      pixKey: 'fundo@opcore.local',
    },
    gestaoUser!.id,
  );
  const fundWithBank = await getFundById(fund!.id);
  assert('Fundos: conta bancária gravada', fundWithBank?.bankAccount?.account === '12345-6');

  await updateFund(
    fund!.id,
    {
      regulatoryLimitsJson: {
        ...(fund!.regulatoryLimitsJson ?? {}),
        min_direitos_creditorios_pct: 67,
        max_ativo_gestor_pct: 15,
      },
    },
    gestaoUser!.id,
  );
  const fundLimits = await getFundById(fund!.id);
  assert(
    'Fundos: limites regulatórios editáveis',
    fundLimits?.regulatoryLimitsJson?.min_direitos_creditorios_pct === 67,
  );

  // --- Onboarding cotista → approve sem criar cotista ---
  const cpf = `9${Date.now().toString().slice(-10)}`.slice(0, 11);
  const onboarding = await createOnboarding({
    partyType: 'pf',
    cpfCnpj: cpf,
    legalName: 'Cotista Simulação E2E',
    fundId: fund!.id,
    quotaType: 'senior_i',
    kind: 'cotista',
  });
  assert('Onboarding: criado', !!onboarding?.id, onboarding?.id);

  await advanceToStep6(onboarding!.id, 'cotista', complianceUser!.id);

  let approveFailed = false;
  try {
    await approveOnboarding(onboarding!.id, 'cotista', complianceUser!.id, '127.0.0.1', '');
  } catch {
    approveFailed = true;
  }
  assert('Onboarding: approve sem justificativa falha', approveFailed);

  await approveOnboarding(
    onboarding!.id,
    'cotista',
    complianceUser!.id,
    '127.0.0.1',
    'Documentação completa e risco baixo — aprovação compliance_director',
  );
  const afterApprove = await prisma.onboardingProcess.findUnique({ where: { id: onboarding!.id } });
  const cotistaBeforeDeposit = await prisma.cotista.findUnique({
    where: { partyId: afterApprove!.partyId },
  });
  assert('Onboarding: status aprovado', afterApprove?.status === 'aprovado');
  assert('Onboarding: justificativa persistida', !!afterApprove?.approvalJustification);
  assert('Onboarding: NÃO cria cotista na aprovação', cotistaBeforeDeposit == null);

  // --- Gestão confirma depósito ---
  const deposit = await confirmDeposit(
    {
      onboardingId: onboarding!.id,
      amount: 100_000,
      proofUri: 's3://proofs/deposito-e2e.pdf',
      quotaCount: 10,
      bankAccount: {
        bankCode: '001',
        branch: '1234',
        account: '99999-0',
        accountType: 'corrente',
      },
    },
    gestaoUser!.id,
    '127.0.0.1',
  );
  assert('Depósito: cotista criado', !!deposit.cotista?.id, deposit.cotista?.id);

  const links = await prisma.partyFundLink.findMany({ where: { partyId: afterApprove!.partyId } });
  assert(
    'Depósito: party_fund_link com saldo',
    links.length === 1 && Number(links[0]!.initialInvestment) === 100_000,
  );

  const txsAporte = await listTransactions({ fundId: fund!.id, partyId: afterApprove!.partyId });
  assert(
    'Transações: aporte registrado',
    txsAporte.some((t) => t.type === 'aporte' && t.signedAmount === 100_000),
  );

  // --- Conta única ---
  await upsertCotistaBankAccount(
    deposit.cotista!.id,
    { bankCode: '237', branch: '0002', account: '55555-5', accountType: 'corrente' },
    gestaoUser!.id,
  );
  const banks = await prisma.partyBankAccount.findMany({
    where: { partyId: afterApprove!.partyId },
  });
  assert('Conta única: apenas 1 conta', banks.length === 1, String(banks.length));
  assert('Conta única: conta substituída', banks[0]?.account === '55555-5');

  // --- Cedente ---
  const cnpj = `${Date.now()}0001`.slice(0, 14);
  const cedenteOnb = await createOnboarding({
    partyType: 'pj',
    cpfCnpj: cnpj,
    legalName: 'Cedente Glanos E2E LTDA',
    fundId: fund!.id,
    kind: 'cedente',
  });
  await advanceToStep6(cedenteOnb!.id, 'cedente', complianceUser!.id);
  await approveOnboarding(
    cedenteOnb!.id,
    'cedente',
    complianceUser!.id,
    '127.0.0.1',
    'Cedente PJ com docs e UBOs ok',
  );
  const cedente = await prisma.cedente.findFirst({
    where: { partyId: cedenteOnb!.partyId },
  });
  const ubos = await prisma.partyBeneficialOwner.findMany({
    where: { partyId: cedenteOnb!.partyId },
  });
  assert('Cedente: registro criado na aprovação', !!cedente);
  assert('Cedente: UBOs persistidos', ubos.length >= 1, String(ubos.length));

  // --- Investidos ---
  let dcBlocked = false;
  try {
    await createInvestido(
      {
        fundId: fund!.id,
        assetClass: 'direito_creditorio',
        title: 'Nota comercial sem cedente',
        amount: 50_000,
        justification: 'Tentativa inválida sem cedente aprovado',
        acquiredAt: new Date().toISOString().slice(0, 10),
      },
      gestaoUser!.id,
    );
  } catch {
    dcBlocked = true;
  }
  assert('Investidos: DC sem cedente bloqueia', dcBlocked);

  const invDc = await createInvestido(
    {
      fundId: fund!.id,
      assetClass: 'direito_creditorio',
      title: 'Nota comercial Glanos',
      amount: 80_000,
      justification: 'Aquisição de direito creditório conforme política do fundo',
      cedenteId: cedente!.id,
      acquisitionDocumentUri: 's3://docs/nota-glanos.pdf',
      paymentProofUri: 's3://docs/pagamento-glanos.pdf',
      acquiredAt: new Date().toISOString().slice(0, 10),
    },
    gestaoUser!.id,
  );
  assert('Investidos: DC com cedente ok', !!invDc.id);

  const invAcao = await createInvestido(
    {
      fundId: fund!.id,
      assetClass: 'acoes',
      title: 'Ações PETR4',
      amount: 10_000,
      justification: 'Posição de liquidez e diversificação',
      acquiredAt: new Date().toISOString().slice(0, 10),
    },
    gestaoUser!.id,
  );
  assert('Investidos: ações sem comprovante ok', !!invAcao.id && !invAcao.paymentProofUri);

  const investidos = await listInvestidos(fund!.id);
  assert('Investidos: listagem', investidos.length >= 2, String(investidos.length));

  const txsCompra = await listTransactions({ fundId: fund!.id, type: 'compra_ativo' });
  assert(
    'Transações: compra_ativo negativo',
    txsCompra.some((t) => t.signedAmount < 0),
  );

  // --- Semáforo ---
  const compliance = await computeFundComplianceStatus(fund!.id);
  assert(
    'Compliance: getFundStatus calculado',
    !!compliance && typeof compliance.alocacoes?.direito_creditorio === 'number',
  );
  assert('Compliance: PL definido', compliance != null && Number.isFinite(compliance.pl));

  // --- Alertas fracionados (só aportes pequenos) ---
  const partyId = afterApprove!.partyId;
  for (let i = 0; i < 10; i++) {
    await prisma.fundTransaction.create({
      data: {
        fundId: fund!.id,
        type: 'aporte',
        counterpartyKind: 'cotista',
        partyId,
        amount: 5500,
        signedAmount: 5500,
        description: `aporte fracionado ${i}`,
        status: 'aprovado',
        occurredAt: new Date(),
        createdById: gestaoUser!.id,
      },
    });
  }
  await maybeAlertFragmentedAportes(partyId, fund!.id, gestaoUser!.id);
  const alert = await prisma.complianceAlert.findFirst({
    where: { type: 'pagamento_picado', entityId: partyId },
    orderBy: { createdAt: 'desc' },
  });
  assert('Alertas: pagamento_picado gerado', !!alert, alert?.severity);

  // --- Relatórios ---
  const from = new Date();
  from.setDate(from.getDate() - 1);
  const to = new Date();
  to.setDate(to.getDate() + 1);
  const reportCompliance = await generateReport({
    type: 'compliance',
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  assert(
    'Relatórios: compliance inclui justificativa',
    reportCompliance.body.includes('aprovação compliance_director') ||
      reportCompliance.body.includes('Documentação completa'),
  );
  const reportGestao = await generateReport({
    type: 'gestao',
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  assert(
    'Relatórios: gestão inclui investidos',
    reportGestao.body.includes('Nota comercial Glanos') ||
      reportGestao.body.includes('Investimentos'),
  );

  // --- Dashboard pós-fluxo ---
  const summaryAfter = await getSummary();
  assert(
    'Dashboard: cotistas aprovados aumentou ou manteve',
    summaryAfter.approvedShareholders >= summaryBefore.approvedShareholders,
    `${summaryBefore.approvedShareholders} → ${summaryAfter.approvedShareholders}`,
  );

  const cotistas = await listCotistas(['cotistas.read', 'cotistas.view_kyc'], true);
  assert(
    'Cotistas: simulado aparece na lista',
    cotistas.some(
      (c) =>
        c.id === deposit.cotista!.id ||
        (c as { legalName?: string }).legalName?.includes('Simulação'),
    ),
  );

  console.log(
    `\n=== Resultado: ${results.filter((r) => r.ok).length}/${results.length} PASS ===\n`,
  );
}

main()
  .catch((err) => {
    console.error('\nSimulação interrompida:', err);
    console.log(
      `\n=== Resultado parcial: ${results.filter((r) => r.ok).length}/${results.length} PASS ===\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
