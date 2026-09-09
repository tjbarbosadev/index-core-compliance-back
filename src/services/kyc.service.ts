import { createHash } from 'node:crypto';
import type { AlertSeverity, AlertType, Prisma, RiskLevel } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { prisma } from '../db/index.js';
import { ComplianceApiError, complianceApiClient } from '../lib/compliance/client.js';
import { buildKycReportPdf } from '../lib/compliance/pdf.js';
import type { ComplianceDossier, RiskLevel as HubRiskLevel } from '../lib/compliance/types.js';
import { APP_ERROR } from '../lib/errors.js';
import { fileUriForKey, getAbsolutePath, saveFile } from '../lib/storage.js';
import { logAudit } from './audit.service.js';
import type { GenerateKycInput, ListKycInput } from '../schemas/kyc.schema.js';

const HUB_ALERT_TYPE_MAP: Record<string, AlertType> = {
  pep: 'pep',
  lista_restritiva: 'lista_restritiva',
  restrictive_list: 'lista_restritiva',
  pj_sanctioned: 'lista_restritiva',
  sanctioned: 'lista_restritiva',
  collections_presence: 'outro',
  cadastro_expirado: 'cadastro_expirado',
  documento_invalido: 'documento_invalido',
  pagamento_picado: 'pagamento_picado',
  transferencia_anomala: 'transferencia_anomala',
  retirada_acelerada: 'retirada_acelerada',
  violacao_alocacao: 'violacao_alocacao',
  outro: 'outro',
};

const ALERT_SEVERITIES: AlertSeverity[] = ['baixa', 'media', 'alta', 'critica'];

function toAlertType(hubType: string): AlertType {
  return HUB_ALERT_TYPE_MAP[hubType] ?? 'outro';
}

function toAlertSeverity(value: string | undefined): AlertSeverity {
  if (value && ALERT_SEVERITIES.includes(value as AlertSeverity)) {
    return value as AlertSeverity;
  }
  const map: Record<string, AlertSeverity> = {
    low: 'baixa',
    medium: 'media',
    high: 'alta',
    critical: 'critica',
  };
  return (value && map[value]) || 'media';
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function mapComplianceError(error: unknown): never {
  if (error instanceof ComplianceApiError) {
    if (error.status === 500 && error.message.includes('COMPLIANCE_API_SERVICE_KEY')) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'API de compliance não configurada (COMPLIANCE_API_SERVICE_KEY)',
      });
    }
    if (error.status === 401 || error.status === 403) {
      throw new TRPCError({ code: 'FORBIDDEN', message: error.message });
    }
    if (error.status === 404) {
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    }
    if (error.status === 504) {
      throw new TRPCError({ code: 'TIMEOUT', message: error.message });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: error.message,
    });
  }
  throw error;
}

function toRiskLevel(level: string | undefined): RiskLevel {
  const allowed: RiskLevel[] = ['baixo', 'medio', 'alto', 'muito_alto'];
  if (allowed.includes(level as RiskLevel)) return level as RiskLevel;
  return 'medio';
}

function isPep(dossier: ComplianceDossier): boolean {
  const pldft = dossier.sections?.pldft;
  if (!pldft || typeof pldft !== 'object') return false;
  return Boolean((pldft as { isPep?: boolean }).isPep);
}

function hasRestrictiveList(dossier: ComplianceDossier): boolean {
  const pldft = dossier.sections?.pldft;
  if (!pldft || typeof pldft !== 'object') return false;
  const hits = (pldft as { restrictiveListHits?: unknown[] }).restrictiveListHits;
  return Array.isArray(hits) && hits.length > 0;
}

async function createComplianceAlertsFromDossier(params: {
  dossier: ComplianceDossier;
  document: string;
  reportId: string;
  partyId: string | null;
  userId: string;
}) {
  const { dossier, document, reportId, partyId, userId } = params;
  const entityType = partyId ? 'party' : 'kyc_report';
  const entityId = partyId ?? reportId;
  const createdTypes = new Set<AlertType>();

  const createOnce = async (type: AlertType, severity: AlertSeverity, description: string) => {
    if (createdTypes.has(type)) return;
    createdTypes.add(type);
    await prisma.complianceAlert.create({
      data: {
        type,
        severity,
        entityType,
        entityId,
        description,
        createdById: userId,
      },
    });
  };

  for (const alert of dossier.compliance?.alerts ?? []) {
    await createOnce(
      toAlertType(alert.type),
      toAlertSeverity(alert.severity),
      `Alerta KYC (${alert.type}) no documento ${document}`,
    );
  }

  if (isPep(dossier)) {
    await createOnce('pep', 'alta', `PEP identificado no dossiê KYC ${document}`);
  }
  if (hasRestrictiveList(dossier)) {
    await createOnce('lista_restritiva', 'critica', `Lista restritiva no dossiê KYC ${document}`);
  }

  const blocked = Boolean(dossier.risk?.blocked || dossier.compliance?.blocked);
  if (blocked) {
    await createOnce('lista_restritiva', 'critica', `Bloqueio no veredito KYC ${document}`);
  } else if (dossier.risk?.level === 'muito_alto') {
    await createOnce('outro', 'critica', `Risco muito alto no dossiê KYC ${document}`);
  }
}

function mapReport(row: {
  id: string;
  document: string;
  documentType: string;
  partyId: string | null;
  onboardingId: string | null;
  riskLevel: RiskLevel;
  complianceStatus: string;
  blocked: boolean;
  dossierJson: Prisma.JsonValue;
  reportHash: string;
  pdfUri: string | null;
  createdById: string;
  createdAt: Date;
  party?: { id: string; legalName: string; cpfCnpj: string } | null;
  createdBy?: { id: string; name: string; email: string } | null;
}) {
  return {
    id: row.id,
    document: row.document,
    documentType: row.documentType as 'CPF' | 'CNPJ',
    partyId: row.partyId,
    onboardingId: row.onboardingId,
    riskLevel: row.riskLevel,
    complianceStatus: row.complianceStatus,
    blocked: row.blocked,
    dossier: row.dossierJson as unknown as ComplianceDossier,
    reportHash: row.reportHash,
    pdfUri: row.pdfUri,
    pdfUrl: `/files/kyc-reports/${row.id}`,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    party: row.party
      ? { id: row.party.id, legalName: row.party.legalName, cpfCnpj: row.party.cpfCnpj }
      : null,
    createdBy: row.createdBy
      ? { id: row.createdBy.id, name: row.createdBy.name, email: row.createdBy.email }
      : null,
  };
}

const reportInclude = {
  party: { select: { id: true, legalName: true, cpfCnpj: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

export async function generateKycReport(
  input: GenerateKycInput,
  userId: string,
  ipAddress?: string,
) {
  const document = digitsOnly(input.document);
  if (input.documentType === 'CPF' && document.length !== 11) {
    throw APP_ERROR.BAD_REQUEST('CPF inválido');
  }
  if (input.documentType === 'CNPJ' && document.length !== 14) {
    throw APP_ERROR.BAD_REQUEST('CNPJ inválido');
  }

  let partyId = input.partyId ?? null;
  if (input.onboardingId) {
    const process = await prisma.onboardingProcess.findUnique({
      where: { id: input.onboardingId },
      select: { id: true, partyId: true },
    });
    if (!process) throw APP_ERROR.NOT_FOUND('Onboarding');
    if (!partyId) partyId = process.partyId;
  }

  if (partyId) {
    const party = await prisma.party.findUnique({ where: { id: partyId }, select: { id: true } });
    if (!party) throw APP_ERROR.NOT_FOUND('Parte');
  } else {
    const matches = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM parties
      WHERE regexp_replace(cpf_cnpj, '[^0-9]', '', 'g') = ${document}
      LIMIT 1
    `;
    if (matches[0]) partyId = matches[0].id;
  }

  let dossier: ComplianceDossier;
  try {
    dossier = await complianceApiClient.getDossier({
      document,
      documentType: input.documentType,
      forceRefresh: input.forceRefresh,
      requestedBy: userId,
    });
  } catch (error) {
    mapComplianceError(error);
  }

  const riskLevel = toRiskLevel(dossier.risk?.level as HubRiskLevel | undefined);
  const reportHash =
    dossier.audit?.reportHash ||
    dossier.meta?.hash ||
    `sha256:${createHash('sha256').update(JSON.stringify(dossier)).digest('hex').slice(0, 40)}`;

  const report = await prisma.kycReport.create({
    data: {
      document,
      documentType: input.documentType,
      partyId,
      onboardingId: input.onboardingId ?? null,
      riskLevel,
      complianceStatus:
        dossier.risk?.complianceStatus ?? dossier.compliance?.status ?? 'desconhecido',
      blocked: Boolean(dossier.risk?.blocked || dossier.compliance?.blocked),
      dossierJson: dossier as unknown as Prisma.InputJsonValue,
      reportHash,
      createdById: userId,
    },
  });

  const pdfBuffer = await buildKycReportPdf(dossier);
  const key = `kyc-reports/${report.id}.pdf`;
  await saveFile(key, pdfBuffer);
  const pdfUri = fileUriForKey(key);

  const updated = await prisma.kycReport.update({
    where: { id: report.id },
    data: { pdfUri },
    include: reportInclude,
  });

  if (partyId) {
    const pep = isPep(dossier);
    await prisma.party.update({
      where: { id: partyId },
      data: {
        riskLevel,
        ...(pep ? { pepFlag: true } : {}),
      },
    });
  }

  await createComplianceAlertsFromDossier({
    dossier,
    document,
    reportId: report.id,
    partyId,
    userId,
  });

  await logAudit({
    userId,
    action: 'kyc.generate',
    entityType: 'kyc_report',
    entityId: report.id,
    details: {
      document,
      documentType: input.documentType,
      riskLevel,
      partyId,
      onboardingId: input.onboardingId ?? null,
    },
    ipAddress,
  });

  return mapReport(updated);
}

export async function getKycReportById(id: string) {
  const row = await prisma.kycReport.findUnique({
    where: { id },
    include: reportInclude,
  });
  if (!row) throw APP_ERROR.NOT_FOUND('Relatório KYC');
  return mapReport(row);
}

export async function listKycReports(input: ListKycInput) {
  const page = input.page ?? 1;
  const limit = input.limit ?? 20;
  const where: Prisma.KycReportWhereInput = {};
  if (input.document) where.document = { contains: digitsOnly(input.document) };
  if (input.partyId) where.partyId = input.partyId;
  if (input.riskLevel) where.riskLevel = input.riskLevel;

  const [total, rows] = await Promise.all([
    prisma.kycReport.count({ where }),
    prisma.kycReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: reportInclude,
    }),
  ]);

  return {
    total,
    page,
    limit,
    items: rows.map(mapReport),
  };
}

export async function getKycReportPdfPath(
  id: string,
): Promise<{ absolutePath: string; fileName: string }> {
  const row = await prisma.kycReport.findUnique({
    where: { id },
    select: { id: true, document: true, documentType: true, pdfUri: true },
  });
  if (!row) throw APP_ERROR.NOT_FOUND('Relatório KYC');
  if (!row.pdfUri) throw APP_ERROR.BAD_REQUEST('PDF ainda não disponível');

  const key = row.pdfUri.startsWith('local://')
    ? row.pdfUri.slice('local://'.length)
    : `kyc-reports/${row.id}.pdf`;

  return {
    absolutePath: getAbsolutePath(key),
    fileName: `kyc-${row.documentType.toLowerCase()}-${row.document}.pdf`,
  };
}
