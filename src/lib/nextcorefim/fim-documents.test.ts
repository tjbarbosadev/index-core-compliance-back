import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cotistaFindUnique,
  partyFindUnique,
  partyUpdate,
  ensureApplication,
  listDocuments,
  uploadDocument,
  deleteDocument,
} = vi.hoisted(() => ({
  cotistaFindUnique: vi.fn(),
  partyFindUnique: vi.fn(),
  partyUpdate: vi.fn(),
  ensureApplication: vi.fn(),
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
  prisma: {
    cotista: { findUnique: cotistaFindUnique },
    party: { findUnique: partyFindUnique, update: partyUpdate },
  },
}));

vi.mock('./client.js', () => ({
  NextcorefimApiError: class NextcorefimApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = 'NextcorefimApiError';
    }
  },
  nextcorefimClient: {
    ensureApplication,
    listDocuments,
    uploadDocument,
    deleteDocument,
  },
}));

vi.mock('../../services/permission.service.js', () => ({
  hasPermissionInList: (perms: string[], key: string, isAdmin: boolean) =>
    isAdmin || perms.includes(key),
}));

import {
  ensureFimApplicationForParty,
  getFimDocumentsForCotista,
  uploadFimDocumentForCotista,
} from './fim-documents.js';

const party = {
  id: 'party-1',
  type: 'pf',
  cpfCnpj: '123.456.789-09',
  legalName: 'Jane Doe',
  fimApplicationId: null as string | null,
  contacts: [{ email: 'jane@example.com', isPrimary: true }],
  beneficialOwners: [],
};

describe('fim-documents', () => {
  beforeEach(() => {
    cotistaFindUnique.mockReset();
    partyFindUnique.mockReset();
    partyUpdate.mockReset();
    ensureApplication.mockReset();
    listDocuments.mockReset();
    uploadDocument.mockReset();
    deleteDocument.mockReset();
  });

  it('reuses Party.fimApplicationId without calling ensure', async () => {
    partyFindUnique.mockResolvedValue({ ...party, fimApplicationId: 'app-existing' });

    const id = await ensureFimApplicationForParty('party-1');

    expect(id).toBe('app-existing');
    expect(ensureApplication).not.toHaveBeenCalled();
  });

  it('ensures application by CPF and persists fimApplicationId', async () => {
    partyFindUnique.mockResolvedValue(party);
    ensureApplication.mockResolvedValue({
      id: 'app-new',
      type: 'PF',
      taxId: '12345678909',
      created: true,
    });
    partyUpdate.mockResolvedValue({});

    const id = await ensureFimApplicationForParty('party-1');

    expect(id).toBe('app-new');
    expect(ensureApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PF',
        taxId: '12345678909',
        legalName: 'Jane Doe',
      }),
    );
    expect(partyUpdate).toHaveBeenCalledWith({
      where: { id: 'party-1' },
      data: { fimApplicationId: 'app-new' },
    });
  });

  it('lists documents after ensuring the FIM application', async () => {
    cotistaFindUnique.mockResolvedValue({ id: 'cot-1', partyId: 'party-1', party });
    partyFindUnique.mockResolvedValue({ ...party, fimApplicationId: 'app-1' });
    listDocuments.mockResolvedValue({
      id: 'app-1',
      type: 'PF',
      complete: false,
      slots: [],
    });

    const checklist = await getFimDocumentsForCotista('cot-1', ['cotistas.view_kyc'], false);

    expect(checklist.id).toBe('app-1');
    expect(listDocuments).toHaveBeenCalledWith('app-1');
  });

  it('proxies upload multipart body to nextcorefim', async () => {
    cotistaFindUnique.mockResolvedValue({ id: 'cot-1', partyId: 'party-1', party });
    partyFindUnique.mockResolvedValue({ ...party, fimApplicationId: 'app-1' });
    uploadDocument.mockResolvedValue({
      id: 'app-1',
      type: 'PF',
      complete: false,
      slots: [],
    });

    const body = Buffer.from('multipart-body');
    await uploadFimDocumentForCotista('cot-1', 'multipart/form-data; boundary=x', body);

    expect(uploadDocument).toHaveBeenCalledWith('app-1', 'multipart/form-data; boundary=x', body);
  });
});
