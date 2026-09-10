import { prisma } from '../../db/index.js';
import { APP_ERROR } from '../errors.js';
import { hasPermissionInList } from '../../services/permission.service.js';
import { nextcorefimClient, NextcorefimApiError, type FimDocumentsChecklist } from './client.js';

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function mapFimError(err: unknown): never {
  if (err instanceof NextcorefimApiError) {
    if (err.status === 404) throw APP_ERROR.NOT_FOUND(err.message);
    if (err.status === 400) throw APP_ERROR.BAD_REQUEST(err.message);
    if (err.status === 401 || err.status === 403) throw APP_ERROR.FORBIDDEN();
    if (err.status === 503 || err.status === 500) {
      throw APP_ERROR.BAD_REQUEST(err.message);
    }
    throw APP_ERROR.BAD_REQUEST(err.message);
  }
  throw err;
}

async function loadCotistaParty(cotistaId: string) {
  const cotista = await prisma.cotista.findUnique({
    where: { id: cotistaId },
    include: {
      party: {
        include: {
          contacts: true,
          beneficialOwners: true,
        },
      },
    },
  });
  if (!cotista) throw APP_ERROR.NOT_FOUND('Cotista');
  return cotista;
}

/**
 * Ensures a nextcorefim Application exists for this party (by CPF/CNPJ)
 * and persists `Party.fimApplicationId`. Does not copy files.
 */
export async function ensureFimApplicationForParty(partyId: string): Promise<string> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    include: {
      contacts: true,
      beneficialOwners: true,
    },
  });
  if (!party) throw APP_ERROR.NOT_FOUND('Party');

  if (party.fimApplicationId) {
    return party.fimApplicationId;
  }

  const taxId = digitsOnly(party.cpfCnpj);
  const type = party.type === 'pj' ? 'PJ' : 'PF';
  const contact = party.contacts.find((c) => c.isPrimary) ?? party.contacts[0];

  try {
    const result = await nextcorefimClient.ensureApplication({
      type,
      taxId,
      email: contact?.email ?? undefined,
      legalName: party.legalName,
      administrators:
        type === 'PJ'
          ? party.beneficialOwners.map((o) => ({
              name: o.ownerName,
              cpf: digitsOnly(o.ownerCpfCnpj) || undefined,
            }))
          : undefined,
    });

    await prisma.party.update({
      where: { id: partyId },
      data: { fimApplicationId: result.id },
    });

    return result.id;
  } catch (err) {
    mapFimError(err);
  }
}

export async function getFimDocumentsForCotista(
  cotistaId: string,
  permissions: string[],
  isAdmin: boolean,
): Promise<FimDocumentsChecklist> {
  const canViewKyc = hasPermissionInList(permissions, 'cotistas.view_kyc', isAdmin);
  if (!canViewKyc) throw APP_ERROR.FORBIDDEN();

  const cotista = await loadCotistaParty(cotistaId);
  const applicationId = await ensureFimApplicationForParty(cotista.partyId);

  try {
    return await nextcorefimClient.listDocuments(applicationId);
  } catch (err) {
    mapFimError(err);
  }
}

export async function uploadFimDocumentForCotista(
  cotistaId: string,
  contentType: string,
  body: Buffer,
): Promise<FimDocumentsChecklist> {
  const cotista = await loadCotistaParty(cotistaId);
  const applicationId = await ensureFimApplicationForParty(cotista.partyId);

  try {
    return await nextcorefimClient.uploadDocument(applicationId, contentType, body);
  } catch (err) {
    mapFimError(err);
  }
}

export async function deleteFimDocumentForCotista(
  cotistaId: string,
  documentId: string,
): Promise<FimDocumentsChecklist> {
  const cotista = await loadCotistaParty(cotistaId);
  const applicationId = await ensureFimApplicationForParty(cotista.partyId);

  try {
    return await nextcorefimClient.deleteDocument(applicationId, documentId);
  } catch (err) {
    mapFimError(err);
  }
}

export async function downloadFimDocumentForCotista(
  cotistaId: string,
  documentId: string,
  disposition: 'inline' | 'attachment',
): Promise<Response> {
  const cotista = await loadCotistaParty(cotistaId);
  const applicationId = await ensureFimApplicationForParty(cotista.partyId);

  try {
    return await nextcorefimClient.downloadDocument(applicationId, documentId, disposition);
  } catch (err) {
    mapFimError(err);
  }
}
