import { createHash, randomUUID } from 'node:crypto';
import type { Cotista, Party, PartnerDocument } from '@prisma/client';
import { prisma } from '../db/index.js';
import {
  deletePartnerFile,
  downloadPartnerFile,
  MegaError,
  uploadPartnerFile,
} from '../lib/mega/client.js';
import { sanitizeFileName } from '../lib/mega/folder.js';
import { logAudit } from './audit.service.js';

export const PARTNER_DOCUMENT_ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const PARTNER_DOCUMENT_MAX_BYTES = 12 * 1024 * 1024;
export const PARTNER_DOCUMENT_LABEL_MAX = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PartnerDocumentsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PartnerDocumentsError';
  }
}

export type PartnerDocumentDto = {
  id: string;
  label: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
};

type Identity = { document: string; partyId: string; cotistaId: string };
type IdentityRow = Party & { cotista: Cotista | null };

function toDto(row: PartnerDocument): PartnerDocumentDto {
  return {
    id: row.id,
    label: row.label,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeDocument(value: string): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 11 && digits.length !== 14) {
    throw new PartnerDocumentsError(
      400,
      'Documento inválido: informe CPF (11) ou CNPJ (14 dígitos)',
    );
  }
  return digits;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

function mapMega(error: unknown): never {
  if (error instanceof PartnerDocumentsError) throw error;
  if (error instanceof MegaError) throw new PartnerDocumentsError(error.status, error.message);
  throw error;
}

async function bestEffortDeleteMega(megaId: string): Promise<void> {
  try {
    await deletePartnerFile(megaId);
  } catch {
    // best-effort cleanup
  }
}

async function audit(
  action: 'upload' | 'list' | 'download' | 'delete',
  partnerId: string,
  identity: Identity,
  entityId: string,
  ip: string | null,
): Promise<void> {
  try {
    await logAudit({
      userId: null,
      action: `partner.documents.${action}`,
      entityType: 'partner_document',
      entityId,
      details: {
        partnerId,
        partyId: identity.partyId,
        cotistaId: identity.cotistaId,
        document: identity.document,
      },
      ipAddress: ip ?? undefined,
      result: 'sucesso',
    });
  } catch {
    // audit must not break the operation
  }
}

async function loadByCotistaId(cotistaId: string, document: string): Promise<Identity> {
  if (!UUID_RE.test(cotistaId)) {
    throw new PartnerDocumentsError(404, 'Cotista não encontrado');
  }
  const cotista = await prisma.cotista.findUnique({
    where: { id: cotistaId },
    include: { party: true },
  });
  if (!cotista || !cotista.party || cotista.party.deletedAt) {
    throw new PartnerDocumentsError(404, 'Cotista não encontrado');
  }
  if (cotista.party.cpfCnpj.replace(/\D/g, '') !== document) {
    throw new PartnerDocumentsError(409, 'cotistaId não corresponde ao documento informado');
  }
  return { document, partyId: cotista.party.id, cotistaId: cotista.id };
}

async function findPartyByDocument(document: string): Promise<IdentityRow | null> {
  return prisma.party.findFirst({
    where: { cpfCnpj: document, deletedAt: null },
    include: { cotista: true },
  });
}

async function resolveForRead(input: { document: string; cotistaId?: string }): Promise<Identity> {
  if (input.cotistaId) return loadByCotistaId(input.cotistaId, input.document);
  const party = await findPartyByDocument(input.document);
  if (!party?.cotista) throw new PartnerDocumentsError(404, 'Cotista não encontrado');
  return { document: input.document, partyId: party.id, cotistaId: party.cotista.id };
}

async function createPartyWithCotista(document: string, name: string): Promise<Identity> {
  const created = await prisma.party.create({
    data: {
      type: document.length === 11 ? 'pf' : 'pj',
      cpfCnpj: document,
      legalName: name,
      excludeFromPl: true,
      status: 'aprovado',
      riskLevel: 'baixo',
      pepFlag: false,
      approvedAt: new Date(),
      cotista: { create: {} },
    },
    include: { cotista: true },
  });
  if (!created.cotista) {
    throw new PartnerDocumentsError(500, 'Falha ao criar cotista');
  }
  return { document, partyId: created.id, cotistaId: created.cotista.id };
}

async function resolveForWrite(input: {
  document: string;
  cotistaId?: string;
  name?: string;
}): Promise<Identity> {
  if (input.cotistaId) return loadByCotistaId(input.cotistaId, input.document);

  const party = await findPartyByDocument(input.document);
  if (party) {
    if (party.cotista) {
      return { document: input.document, partyId: party.id, cotistaId: party.cotista.id };
    }
    const cotista = await prisma.cotista.create({ data: { partyId: party.id } });
    return { document: input.document, partyId: party.id, cotistaId: cotista.id };
  }

  const name = input.name?.trim();
  if (!name) {
    throw new PartnerDocumentsError(
      400,
      'Informe name para cadastrar o primeiro documento deste CPF/CNPJ',
    );
  }
  try {
    return await createPartyWithCotista(input.document, name);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await findPartyByDocument(input.document);
    if (winner?.cotista) {
      return { document: input.document, partyId: winner.id, cotistaId: winner.cotista.id };
    }
    throw error;
  }
}

export async function uploadPartnerDocument(input: {
  partner: { id: string; name: string };
  document: string;
  cotistaId?: string;
  name?: string;
  label?: string;
  file: { buffer: Buffer; originalName: string; mimeType: string; size: number };
  ip: string | null;
}): Promise<{
  status: 200 | 201;
  body: PartnerDocumentDto & {
    created: boolean;
    document: string;
    cotistaId: string;
    partyId: string;
  };
}> {
  const document = normalizeDocument(input.document);
  const { file } = input;

  if (!PARTNER_DOCUMENT_ALLOWED_MIME.has(file.mimeType)) {
    throw new PartnerDocumentsError(
      400,
      'Tipo de arquivo não permitido (use PDF, JPEG, PNG ou WebP)',
    );
  }
  const actualSize = file.buffer.length;
  if (actualSize === 0) {
    throw new PartnerDocumentsError(400, 'Arquivo vazio');
  }
  if (Math.max(file.size, actualSize) > PARTNER_DOCUMENT_MAX_BYTES) {
    throw new PartnerDocumentsError(400, 'Arquivo excede o limite de 12 MB');
  }
  const label = input.label?.trim() ? input.label.trim() : null;
  if (label && label.length > PARTNER_DOCUMENT_LABEL_MAX) {
    throw new PartnerDocumentsError(400, `label excede ${PARTNER_DOCUMENT_LABEL_MAX} caracteres`);
  }

  const identity = await resolveForWrite({
    document,
    cotistaId: input.cotistaId,
    name: input.name,
  });
  const partnerId = input.partner.id;
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const uniqueWhere = {
    partnerId_partyId_sha256: { partnerId, partyId: identity.partyId, sha256 },
  };

  const respond = async (row: PartnerDocument, created: boolean) => {
    await audit('upload', partnerId, identity, row.id, input.ip);
    return {
      status: (created ? 201 : 200) as 200 | 201,
      body: {
        ...toDto(row),
        created,
        document,
        cotistaId: identity.cotistaId,
        partyId: identity.partyId,
      },
    };
  };

  const existing = await prisma.partnerDocument.findUnique({ where: uniqueWhere });
  if (existing) return respond(existing, false);

  const fileId = randomUUID();
  const fileName = `${fileId}__${sanitizeFileName(file.originalName)}`;

  let uploaded;
  try {
    uploaded = await uploadPartnerFile({
      buffer: file.buffer,
      fileName,
      mimeType: file.mimeType,
      partnerId,
      document,
    });
  } catch (error) {
    mapMega(error);
  }

  let row: PartnerDocument;
  try {
    row = await prisma.partnerDocument.create({
      data: {
        id: fileId,
        partnerId,
        partyId: identity.partyId,
        cotistaId: identity.cotistaId,
        label,
        originalName: file.originalName.slice(0, 255),
        mimeType: file.mimeType,
        size: actualSize,
        sha256,
        megaId: uploaded.id,
        megaPath: uploaded.path,
      },
    });
  } catch (error) {
    await bestEffortDeleteMega(uploaded.id);
    if (isUniqueViolation(error)) {
      const winner = await prisma.partnerDocument.findUnique({ where: uniqueWhere });
      if (winner) return respond(winner, false);
    }
    throw new PartnerDocumentsError(500, 'Falha ao registrar documento');
  }

  return respond(row, true);
}

export async function listPartnerDocuments(input: {
  partner: { id: string };
  document: string;
  cotistaId?: string;
  ip: string | null;
}): Promise<{ document: string; cotistaId: string; partyId: string; items: PartnerDocumentDto[] }> {
  const document = normalizeDocument(input.document);
  const identity = await resolveForRead({ document, cotistaId: input.cotistaId });
  const rows = await prisma.partnerDocument.findMany({
    where: { partnerId: input.partner.id, partyId: identity.partyId },
    orderBy: { createdAt: 'desc' },
  });
  await audit('list', input.partner.id, identity, identity.partyId, input.ip);
  return {
    document,
    cotistaId: identity.cotistaId,
    partyId: identity.partyId,
    items: rows.map(toDto),
  };
}

async function findOwnedDocument(
  partnerId: string,
  partyId: string,
  fileId: string,
): Promise<PartnerDocument> {
  if (!UUID_RE.test(fileId)) {
    throw new PartnerDocumentsError(404, 'Documento não encontrado');
  }
  const row = await prisma.partnerDocument.findFirst({
    where: { id: fileId, partnerId, partyId },
  });
  if (!row) throw new PartnerDocumentsError(404, 'Documento não encontrado');
  return row;
}

export async function downloadPartnerDocument(input: {
  partner: { id: string };
  document: string;
  fileId: string;
  cotistaId?: string;
  ip: string | null;
}): Promise<{ mimeType: string; originalName: string; buffer: Buffer }> {
  const document = normalizeDocument(input.document);
  const identity = await resolveForRead({ document, cotistaId: input.cotistaId });
  const row = await findOwnedDocument(input.partner.id, identity.partyId, input.fileId);

  let buffer: Buffer;
  try {
    buffer = await downloadPartnerFile(row.megaId);
  } catch (error) {
    mapMega(error);
  }

  await audit('download', input.partner.id, identity, row.id, input.ip);
  return { mimeType: row.mimeType, originalName: row.originalName, buffer };
}

export async function deletePartnerDocument(input: {
  partner: { id: string };
  document: string;
  fileId: string;
  cotistaId?: string;
  ip: string | null;
}): Promise<{ ok: true; id: string; document: string; cotistaId: string; partyId: string }> {
  const document = normalizeDocument(input.document);
  const identity = await resolveForRead({ document, cotistaId: input.cotistaId });
  const row = await findOwnedDocument(input.partner.id, identity.partyId, input.fileId);

  try {
    await deletePartnerFile(row.megaId);
  } catch (error) {
    mapMega(error);
  }

  await prisma.partnerDocument.deleteMany({
    where: { id: row.id, partnerId: input.partner.id },
  });
  await audit('delete', input.partner.id, identity, row.id, input.ip);
  return {
    ok: true,
    id: row.id,
    document,
    cotistaId: identity.cotistaId,
    partyId: identity.partyId,
  };
}
