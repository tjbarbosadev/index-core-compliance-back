import type { DocumentType } from '@prisma/client';
import { prisma } from '../db/index.js';
import { env } from '../lib/env.js';
import { APP_ERROR, KYC_DOCUMENT_TYPES } from '../lib/errors.js';
import { buildObjectKey, fileExists, fileUriForKey, keyFromFileUri } from '../lib/storage.js';
import { hasPermissionInList } from './permission.service.js';
import { logAudit } from './audit.service.js';

function mapDocument(doc: {
  id: string;
  partyId: string;
  type: DocumentType;
  fileName: string;
  fileUri: string;
  hashSha256: string;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  rejectionReason: string | null;
  createdAt: Date;
}) {
  return {
    id: doc.id,
    partyId: doc.partyId,
    type: doc.type,
    fileName: doc.fileName,
    fileUri: doc.fileUri,
    hashSha256: doc.hashSha256,
    mimeType: doc.mimeType ?? 'application/octet-stream',
    size: doc.sizeBytes ?? 0,
    status: doc.status,
    rejectionReason: doc.rejectionReason ?? undefined,
    uploadedAt: doc.createdAt.toISOString(),
  };
}

export async function getDocumentUploadUrl(
  input: { partyId: string; type: string; mimeType: string; fileName?: string },
  userId: string,
) {
  const doc = await prisma.document.create({
    data: {
      partyId: input.partyId,
      type: input.type as DocumentType,
      fileName: input.fileName ?? 'document',
      fileUri: '',
      hashSha256: '',
      mimeType: input.mimeType,
      status: 'pendente',
      uploadedById: userId,
    },
  });

  const key = buildObjectKey(input.partyId, input.type, doc.id);
  const uploadUrl = `${env.publicApiUrl}/files/upload/${doc.id}`;

  await prisma.document.update({
    where: { id: doc.id },
    data: { fileUri: fileUriForKey(key) },
  });

  return { uploadUrl, documentId: doc.id };
}

export async function confirmDocumentUpload(documentId: string, hash: string, userId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw APP_ERROR.NOT_FOUND('Documento');

  const key = keyFromFileUri(doc.fileUri);
  const exists = await fileExists(key);
  if (!exists) throw APP_ERROR.BAD_REQUEST('Arquivo não encontrado');

  const updated = await prisma.document.update({
    where: { id: documentId },
    data: { hashSha256: hash, status: 'em_analise' },
  });

  await logAudit({
    userId,
    action: 'documents.confirmUpload',
    entityType: 'document',
    entityId: documentId,
  });

  return mapDocument(updated);
}

export async function listDocumentsByParty(
  partyId: string,
  permissions: string[],
  isAdmin: boolean,
) {
  const canViewKyc = hasPermissionInList(permissions, 'documents.view_kyc', isAdmin);
  const docs = await prisma.document.findMany({
    where: { partyId },
    orderBy: { createdAt: 'desc' },
  });

  if (!canViewKyc) {
    const hasKyc = docs.some((d) => KYC_DOCUMENT_TYPES.has(d.type));
    if (hasKyc) throw APP_ERROR.FORBIDDEN();
    return docs.map(mapDocument);
  }

  return docs.map(mapDocument);
}

export async function validateDocument(
  id: string,
  approved: boolean,
  reason: string | undefined,
  userId: string,
  ip?: string,
) {
  if (!approved && !reason?.trim()) {
    throw APP_ERROR.BAD_REQUEST('Motivo de rejeição obrigatório');
  }

  const doc = await prisma.document.update({
    where: { id },
    data: {
      status: approved ? 'aprovado' : 'rejeitado',
      rejectionReason: approved ? null : reason,
      validatedById: userId,
      validatedAt: new Date(),
    },
  });

  await prisma.documentValidation.create({
    data: {
      documentId: id,
      validatorId: userId,
      method: 'manual',
      result: approved ? 'aprovado' : 'rejeitado',
    },
  });

  await logAudit({
    userId,
    action: approved ? 'documents.approve' : 'documents.reject',
    entityType: 'document',
    entityId: id,
    details: { reason },
    ipAddress: ip,
  });

  return mapDocument(doc);
}
