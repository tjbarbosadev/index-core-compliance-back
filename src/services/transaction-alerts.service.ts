import { prisma } from '../db/index.js';

/** Detect fragmented aportes (pagamento picado): many small aportes summing high in a short window. */
export async function maybeAlertFragmentedAportes(
  partyId: string,
  fundId: string,
  userId?: string,
): Promise<void> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 7);

  const aportes = await prisma.fundTransaction.findMany({
    where: {
      partyId,
      fundId,
      type: 'aporte',
      status: 'aprovado',
      occurredAt: { gte: windowStart },
    },
  });

  const small = aportes.filter((t) => Number(t.amount) <= 10_000);
  if (small.length < 5) return;

  const total = small.reduce((s, t) => s + Number(t.amount), 0);
  if (total < 50_000) return;

  const existing = await prisma.complianceAlert.findFirst({
    where: {
      type: 'pagamento_picado',
      entityId: partyId,
      status: { in: ['novo', 'investigando'] },
      createdAt: { gte: windowStart },
    },
  });
  if (existing) return;

  await prisma.complianceAlert.create({
    data: {
      type: 'pagamento_picado',
      severity: 'critica',
      entityType: 'party',
      entityId: partyId,
      description: `${small.length} aportes fracionados somando R$ ${total.toFixed(2)} em 7 dias (fundo ${fundId})`,
      createdById: userId,
    },
  });
}
