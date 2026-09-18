import { prisma } from '../db/index.js';
import { APP_ERROR } from '../lib/errors.js';
import { searchAudit } from './audit.service.js';

export type GenerateReportInput = {
  type: 'gestao' | 'compliance';
  from: string;
  to: string;
};

function formatRange(from: string, to: string): string {
  return `Período: ${from} a ${to}`;
}

export async function generateReport(input: GenerateReportInput): Promise<{
  type: string;
  from: string;
  to: string;
  generatedAt: string;
  body: string;
}> {
  const fromDate = new Date(input.from);
  const toDate = new Date(input.to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw APP_ERROR.BAD_REQUEST('Datas inválidas');
  }

  const lines: string[] = [];
  lines.push(`Relatório ${input.type === 'compliance' ? 'Compliance' : 'Gestão'}`);
  lines.push(formatRange(input.from, input.to));
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push('');

  const auditLogs = await searchAudit({ from: input.from, to: input.to, limit: 500 });
  lines.push('--- Auditoria ---');
  if (auditLogs.length === 0) {
    lines.push('(sem registros)');
  } else {
    for (const log of auditLogs) {
      lines.push(
        `[${log.createdAt.toISOString()}] ${log.action} · ${log.entityType ?? '-'} · ${log.user?.name ?? 'Sistema'}`,
      );
    }
  }
  lines.push('');

  if (input.type === 'compliance') {
    const onboardings = await prisma.onboardingProcess.findMany({
      where: {
        status: 'aprovado',
        completedAt: { gte: fromDate, lte: toDate },
        approvalJustification: { not: null },
      },
      include: { party: { select: { legalName: true, cpfCnpj: true } } },
      orderBy: { completedAt: 'desc' },
      take: 200,
    });
    lines.push('--- Aprovações de onboarding (justificativas) ---');
    for (const p of onboardings) {
      lines.push(
        `${p.completedAt?.toISOString().slice(0, 10) ?? '-'} · ${p.party.legalName} (${p.party.cpfCnpj}): ${p.approvalJustification}`,
      );
    }
    lines.push('');
  }

  const investments = await prisma.fundInvestment.findMany({
    where: { createdAt: { gte: fromDate, lte: toDate } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  lines.push('--- Investimentos (justificativas) ---');
  if (investments.length === 0) {
    lines.push('(sem registros)');
  } else {
    for (const inv of investments) {
      lines.push(
        `${inv.acquiredAt.toISOString().slice(0, 10)} · ${inv.title} · R$ ${Number(inv.amount).toFixed(2)} · ${inv.justification}`,
      );
    }
  }

  return {
    type: input.type,
    from: input.from,
    to: input.to,
    generatedAt: new Date().toISOString(),
    body: lines.join('\n'),
  };
}
