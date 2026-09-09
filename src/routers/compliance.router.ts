import { z } from 'zod';
import type { AlertSeverity, AlertStatus, Prisma } from '@prisma/client';
import { router, permissionProcedure } from '../trpc/procedures.js';
import { prisma } from '../db/index.js';
import { APP_ERROR } from '../lib/errors.js';

function mapAlert(row: {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  entityType: string | null;
  entityId: string | null;
  description: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    entityType: row.entityType ?? undefined,
    entityId: row.entityId ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export const complianceRouter = router({
  listAlerts: permissionProcedure('compliance.read')
    .input(
      z
        .object({
          status: z.enum(['novo', 'investigando', 'reportado_coaf', 'arquivado']).optional(),
          severity: z.enum(['baixa', 'media', 'alta', 'critica']).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const where: Prisma.ComplianceAlertWhereInput = {};
      if (input?.status) where.status = input.status;
      if (input?.severity) where.severity = input.severity;
      const rows = await prisma.complianceAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map(mapAlert);
    }),

  /** Stub estável até spec 008 (semáforo FIDC / alocação). */
  getFundStatus: permissionProcedure('compliance.read')
    .input(z.object({ fundId: z.string().uuid() }))
    .query(({ input }) => ({
      fundId: input.fundId,
      statusCompliance: 'conforme' as const,
      alocacoes: {} as Record<string, number>,
      limiteMinimo: null as number | null,
      violacoes: [] as string[],
      checkedAt: new Date().toISOString(),
    })),

  investigateAlert: permissionProcedure('compliance.investigate')
    .input(z.object({ alertId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const existing = await prisma.complianceAlert.findUnique({
        where: { id: input.alertId },
      });
      if (!existing) throw APP_ERROR.NOT_FOUND('Alerta');
      const row = await prisma.complianceAlert.update({
        where: { id: input.alertId },
        data: { status: 'investigando' },
      });
      return mapAlert(row);
    }),

  reportToCoaf: permissionProcedure('compliance.write')
    .input(
      z.object({
        alertId: z.string().uuid(),
        protocolNumber: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await prisma.complianceAlert.findUnique({
        where: { id: input.alertId },
      });
      if (!existing) throw APP_ERROR.NOT_FOUND('Alerta');
      const row = await prisma.complianceAlert.update({
        where: { id: input.alertId },
        data: {
          status: 'reportado_coaf',
          reportedToCoafAt: new Date(),
          description: existing.description
            ? `${existing.description} · COAF ${input.protocolNumber}`
            : `Protocolo COAF ${input.protocolNumber}`,
        },
      });
      return mapAlert(row);
    }),

  archiveAlert: permissionProcedure('compliance.write')
    .input(
      z.object({
        alertId: z.string().uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await prisma.complianceAlert.findUnique({
        where: { id: input.alertId },
      });
      if (!existing) throw APP_ERROR.NOT_FOUND('Alerta');
      const row = await prisma.complianceAlert.update({
        where: { id: input.alertId },
        data: {
          status: 'arquivado',
          resolvedAt: new Date(),
          description: input.reason
            ? `${existing.description ?? ''} · Arquivado: ${input.reason}`.trim()
            : existing.description,
        },
      });
      return mapAlert(row);
    }),
});
