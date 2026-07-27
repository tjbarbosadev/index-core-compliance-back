import cron from 'node-cron';
import { prisma } from '../db/index.js';
import { runDailyYieldJob } from '../services/cotista-yield.service.js';

export function registerScheduledJobs() {
  cron.schedule('0 6 * * *', async () => {
    await checkOnboardingExpiration();
    await checkCadastroExpiration();
    await cadastroExpirationAlert();
    try {
      await runDailyYieldJob();
    } catch (err) {
      console.error('[job] falha ao gravar yields diários', err);
    }
  });
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

export { checkOnboardingExpiration, checkCadastroExpiration, cadastroExpirationAlert };
