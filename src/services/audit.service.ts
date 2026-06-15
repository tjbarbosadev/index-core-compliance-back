import type { Prisma } from '@prisma/client';
import type { AuditResult } from '@prisma/client';
import { prisma } from '../db/index.js';

export type AuditInput = {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  result?: AuditResult;
};

export async function logAudit(input: AuditInput) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
      ipAddress: input.ipAddress,
      result: input.result ?? 'sucesso',
    },
    include: { user: { select: { name: true } } },
  });
}

export type AuditSearchInput = {
  entityType?: string;
  entityId?: string;
  userId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export async function searchAudit(input: AuditSearchInput) {
  const limit = input.limit ?? 100;
  return prisma.auditLog.findMany({
    where: {
      entityType: input.entityType,
      entityId: input.entityId,
      userId: input.userId,
      createdAt: {
        gte: input.from ? new Date(input.from) : undefined,
        lte: input.to ? new Date(input.to) : undefined,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: { select: { name: true } } },
  });
}

export function mapAuditLog(log: Awaited<ReturnType<typeof searchAudit>>[number]) {
  return {
    id: log.id,
    userId: log.userId ?? undefined,
    userName: log.user?.name,
    action: log.action,
    entityType: log.entityType ?? '',
    entityId: log.entityId ?? '',
    details: (log.details as Record<string, unknown>) ?? {},
    ipAddress: log.ipAddress ?? undefined,
    result: log.result,
    createdAt: log.createdAt.toISOString(),
  };
}
