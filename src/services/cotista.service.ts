import { prisma } from '../db/index.js';
import { APP_ERROR } from '../lib/errors.js';
import { hasPermissionInList } from './permission.service.js';
import { logAudit } from './audit.service.js';

type GestorRow = {
  id: string;
  cpf_cnpj: string;
  legal_name: string;
  status: string;
  bank_code: string | null;
  branch: string | null;
  account: string | null;
};

export async function mapCotistaFull(cotistaId: string) {
  const cotista = await prisma.cotista.findUnique({
    where: { id: cotistaId },
    include: {
      party: {
        include: {
          contacts: true,
          bankAccounts: true,
          documents: true,
          partyFundLinks: { include: { fund: true } },
        },
      },
    },
  });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');

  const link = cotista.party.partyFundLinks[0];
  const primary =
    cotista.party.bankAccounts.find((b) => b.isPrimary) ?? cotista.party.bankAccounts[0];
  const contact = cotista.party.contacts.find((c) => c.isPrimary) ?? cotista.party.contacts[0];

  return {
    id: cotista.id,
    legalName: cotista.party.legalName,
    cpfCnpj: cotista.party.cpfCnpj,
    status: cotista.party.status,
    type: cotista.party.type,
    riskLevel: cotista.party.riskLevel,
    pepFlag: cotista.party.pepFlag,
    expiresAt: cotista.party.expiresAt?.toISOString() ?? null,
    fundId: link?.fundId ?? '',
    fundName: link?.fund.name ?? '',
    investorProfile: cotista.investorProfile ?? undefined,
    email: contact?.email ?? undefined,
    phone: contact?.phone ?? undefined,
    address: contact?.addressJson ? JSON.stringify(contact.addressJson) : undefined,
    bankCode: primary?.bankCode,
    branch: primary?.branch,
    account: primary?.account,
    bankAccounts: cotista.party.bankAccounts.map((b) => ({
      bankCode: b.bankCode,
      branch: b.branch,
      account: b.account,
      isPrimary: b.isPrimary,
    })),
    documents: cotista.party.documents.map((d) => ({
      id: d.id,
      type: d.type,
      fileName: d.fileName,
      status: d.status,
    })),
    onboardingHistory: [],
  };
}

export function mapRestricted(row: GestorRow) {
  return {
    id: row.id,
    legalName: row.legal_name,
    cpfCnpj: row.cpf_cnpj,
    status: row.status,
    bankCode: row.bank_code ?? undefined,
    branch: row.branch ?? undefined,
    account: row.account ?? undefined,
  };
}

async function listGestorRestricted(): Promise<GestorRow[]> {
  return prisma.$queryRaw<GestorRow[]>`
    SELECT
      c.id,
      p.cpf_cnpj,
      p.legal_name,
      p.status,
      pba.bank_code,
      pba.branch,
      pba.account
    FROM parties p
    JOIN cotistas c ON c.party_id = p.id
    LEFT JOIN party_bank_accounts pba ON pba.party_id = p.id AND pba.is_primary = TRUE
    WHERE p.status = 'aprovado'
      AND (p.expires_at IS NULL OR p.expires_at > NOW())
    ORDER BY p.legal_name ASC
  `;
}

export async function listCotistas(permissions: string[], isAdmin: boolean, status?: string) {
  const canViewKyc = hasPermissionInList(permissions, 'cotistas.view_kyc', isAdmin);

  if (!canViewKyc) {
    const rows = await listGestorRestricted();
    return rows.map(mapRestricted);
  }

  const cotistas = await prisma.cotista.findMany({
    where: status && status !== 'all' ? { party: { status: status as 'aprovado' } } : undefined,
    include: {
      party: {
        include: {
          bankAccounts: true,
          partyFundLinks: { include: { fund: true } },
        },
      },
    },
    orderBy: { party: { legalName: 'asc' } },
  });

  return Promise.all(cotistas.map((c) => mapCotistaFull(c.id)));
}

export async function getCotistaById(id: string, permissions: string[], isAdmin: boolean) {
  const canViewKyc = hasPermissionInList(permissions, 'cotistas.view_kyc', isAdmin);

  if (!canViewKyc) {
    const rows = await listGestorRestricted();
    const row = rows.find((r) => r.id === id);
    return row ? mapRestricted(row) : null;
  }

  const exists = await prisma.cotista.findUnique({ where: { id } });
  if (!exists) return null;
  return mapCotistaFull(id);
}

export async function approveCotista(id: string, expiresAt: string, userId: string, ip?: string) {
  const cotista = await prisma.cotista.findUnique({ where: { id }, include: { party: true } });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');

  await prisma.party.update({
    where: { id: cotista.partyId },
    data: {
      status: 'aprovado',
      expiresAt: new Date(expiresAt),
      approvedAt: new Date(),
      approvedBy: userId,
    },
  });

  await logAudit({
    userId,
    action: 'cotistas.approve',
    entityType: 'cotista',
    entityId: id,
    ipAddress: ip,
  });

  return mapCotistaFull(id);
}

export async function rejectCotista(id: string, reason: string, userId: string, ip?: string) {
  const cotista = await prisma.cotista.findUnique({ where: { id } });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');

  await prisma.party.update({
    where: { id: cotista.partyId },
    data: { status: 'rejeitado' },
  });

  await logAudit({
    userId,
    action: 'cotistas.reject',
    entityType: 'cotista',
    entityId: id,
    details: { reason },
    ipAddress: ip,
  });

  return mapCotistaFull(id);
}

export async function listCedentes() {
  const cedentes = await prisma.cedente.findMany({
    include: { party: true },
    orderBy: { createdAt: 'desc' },
  });
  return cedentes.map((c) => ({
    id: c.id,
    partyId: c.partyId,
    legalName: c.party.legalName,
    cnpj: c.party.cpfCnpj,
    status: c.party.status,
    juntaValidationStatus: c.juntaValidationStatus,
  }));
}
