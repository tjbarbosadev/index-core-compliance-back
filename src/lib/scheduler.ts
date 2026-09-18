import cron from 'node-cron';
import { prisma } from '../db/index.js';
import { runAmortizationAlertJob } from '../services/amortization-alert.service.js';
import { runDailyYieldJob } from '../services/cotista-yield.service.js';

const CRON_TZ = 'America/Sao_Paulo';

/** Jobs diários 06:00 BRT — usable by scheduler and `npm run job:daily`. */
export async function runDailyJobs(): Promise<void> {
  console.log(`[job] daily 06:00 ${CRON_TZ} started`);
  await checkOnboardingExpiration();
  await checkCadastroExpiration();
  await cadastroExpirationAlert();
  try {
    await runDailyYieldJob();
  } catch (err) {
    console.error('[job] falha ao gravar yields diários', err);
    throw err;
  }
  try {
    await runAmortizationAlertJob();
  } catch (err) {
    console.error('[job] falha no alerta de amortização (dry-run)', err);
  }
  try {
    await runKycRenewalJob();
  } catch (err) {
    console.error('[job] falha na renovação KYC 6 meses', err);
  }
  console.log(`[job] daily 06:00 ${CRON_TZ} finished`);
}

export function registerScheduledJobs() {
  cron.schedule(
    '0 6 * * *',
    () => {
      void runDailyJobs().catch((err) => {
        console.error('[job] daily jobs failed', err);
      });
    },
    { timezone: CRON_TZ },
  );
  console.log(`[scheduler] registered daily jobs at 06:00 ${CRON_TZ}`);
}

async function checkOnboardingExpiration() {
  const expired = await prisma.onboardingProcess.findMany({
    where: {
      status: 'em_andamento',
      expiresAt: { lt: new Date() },
    },
  });
  for (const p of expired) {
    await prisma.onboardingProcess.update({
      where: { id: p.id },
      data: { status: 'expirado' },
    });
  }
  if (expired.length > 0) {
    console.log(`[job] ${expired.length} onboardings expirados`);
  }
}

async function checkCadastroExpiration() {
  const parties = await prisma.party.findMany({
    where: {
      status: 'aprovado',
      expiresAt: { lt: new Date() },
    },
  });
  for (const p of parties) {
    await prisma.party.update({
      where: { id: p.id },
      data: { status: 'expirado' },
    });
  }
  if (parties.length > 0) {
    console.log(`[job] ${parties.length} cadastros expirados`);
  }
}

async function cadastroExpirationAlert() {
  const in30Days = new Date();
  in30Days.setDate(in30Days.getDate() + 30);
  const soon = await prisma.party.count({
    where: {
      status: 'aprovado',
      expiresAt: { lte: in30Days, gt: new Date() },
    },
  });
  if (soon > 0) {
    console.log(`[job] ${soon} cadastros expiram em até 30 dias`);
  }
}

const KYC_RENEWAL_MONTHS = 6;

/** Partes aprovadas com KYC ausente ou com mais de 6 meses — renovação ou alerta. */
export async function runKycRenewalJob(): Promise<void> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - KYC_RENEWAL_MONTHS);

  const parties = await prisma.party.findMany({
    where: { status: 'aprovado' },
    select: {
      id: true,
      cpfCnpj: true,
      legalName: true,
      kycReports: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
    },
  });

  const stale = parties.filter((p) => {
    const latest = p.kycReports[0];
    return !latest || latest.createdAt < cutoff;
  });

  if (stale.length === 0) return;

  const systemUser =
    (await prisma.user.findFirst({ where: { isAdmin: true }, orderBy: { createdAt: 'asc' } })) ??
    (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }));

  for (const party of stale) {
    try {
      const digits = party.cpfCnpj.replace(/\D/g, '');
      const documentType = digits.length <= 11 ? 'CPF' : 'CNPJ';

      if (systemUser) {
        const { generateKycReport } = await import('../services/kyc.service.js');
        await generateKycReport(
          { document: digits, documentType, partyId: party.id, forceRefresh: true },
          systemUser.id,
        );
        console.log(`[job] KYC renovado party=${party.id}`);
        continue;
      }
    } catch (err) {
      console.warn(`[job] KYC generate falhou party=${party.id}`, err);
    }

    try {
      const existing = await prisma.complianceAlert.findFirst({
        where: {
          entityType: 'party',
          entityId: party.id,
          type: { in: ['lista_restritiva', 'outro'] },
          status: { in: ['novo', 'investigando'] },
          description: { contains: 'renovação KYC' },
        },
      });
      if (!existing) {
        await prisma.complianceAlert.create({
          data: {
            type: 'outro',
            severity: 'media',
            entityType: 'party',
            entityId: party.id,
            description: `Renovação KYC pendente (> ${KYC_RENEWAL_MONTHS} meses) — ${party.legalName}`,
          },
        });
      }
    } catch (alertErr) {
      console.warn(`[job] alerta KYC falhou party=${party.id}`, alertErr);
    }
  }

  console.log(`[job] KYC renewal processados: ${stale.length}`);
}

export { checkOnboardingExpiration, checkCadastroExpiration, cadastroExpirationAlert, CRON_TZ };
