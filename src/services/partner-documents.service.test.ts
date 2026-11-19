import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, uploadPartnerFile, downloadPartnerFile, deletePartnerFile, logAudit } =
  vi.hoisted(() => ({
    prismaMock: {
      party: { findFirst: vi.fn(), create: vi.fn() },
      cotista: { findUnique: vi.fn(), create: vi.fn() },
      partnerDocument: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
    },
    uploadPartnerFile: vi.fn(),
    downloadPartnerFile: vi.fn(),
    deletePartnerFile: vi.fn(),
    logAudit: vi.fn(),
  }));

vi.mock('../db/index.js', () => ({ prisma: prismaMock }));
vi.mock('./audit.service.js', () => ({ logAudit }));
vi.mock('../lib/mega/client.js', async () => {
  const { MegaError } =
    await vi.importActual<typeof import('../lib/mega/cmd.js')>('../lib/mega/cmd.js');
  return { MegaError, uploadPartnerFile, downloadPartnerFile, deletePartnerFile };
});

import { MegaError } from '../lib/mega/cmd.js';
import {
  deletePartnerDocument,
  downloadPartnerDocument,
  listPartnerDocuments,
  PartnerDocumentsError,
  uploadPartnerDocument,
} from './partner-documents.service.js';

const PARTNER = { id: 'partner-1', name: 'Ipe Core' };
const OTHER_PARTNER = { id: 'partner-2' };
const CPF = '12345678901';
const PARTY_ID = '11111111-1111-4111-8111-111111111111';
const COTISTA_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const buffer = Buffer.from('%PDF-1.4 conteudo');
const sha = createHash('sha256').update(buffer).digest('hex');

function file(overrides: Partial<{ buffer: Buffer; mimeType: string; size: number }> = {}) {
  return {
    buffer,
    originalName: 'Comprovante Endereço.pdf',
    mimeType: 'application/pdf',
    size: buffer.length,
    ...overrides,
  };
}

function docRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    partnerId: PARTNER.id,
    partyId: PARTY_ID,
    cotistaId: COTISTA_ID,
    label: null,
    originalName: 'a.pdf',
    mimeType: 'application/pdf',
    size: buffer.length,
    sha256: sha,
    megaId: 'mega-1',
    megaPath: '/opcore/partner-docs/x/a.pdf',
    createdAt: new Date('2026-11-19T12:00:00.000Z'),
    ...overrides,
  };
}

const partyWithCotista = {
  id: PARTY_ID,
  cpfCnpj: CPF,
  deletedAt: null,
  cotista: { id: COTISTA_ID, partyId: PARTY_ID },
};

function upload(extra: Record<string, unknown> = {}) {
  return uploadPartnerDocument({
    partner: PARTNER,
    document: CPF,
    name: 'Fulano',
    file: file(),
    ip: '1.2.3.4',
    ...extra,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  logAudit.mockResolvedValue({});
  uploadPartnerFile.mockResolvedValue({ id: 'mega-1', path: '/p/f', name: 'f' });
  deletePartnerFile.mockResolvedValue(undefined);
  prismaMock.partnerDocument.findUnique.mockResolvedValue(null);
  prismaMock.partnerDocument.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve(docRow(data as Record<string, unknown>)),
  );
});

describe('uploadPartnerDocument', () => {
  it('normalizes a masked CPF and creates party + cotista on first upload', async () => {
    prismaMock.party.findFirst.mockResolvedValue(null);
    prismaMock.party.create.mockResolvedValue({
      id: PARTY_ID,
      cotista: { id: COTISTA_ID },
    });

    const res = await upload({ document: '123.456.789-01' });

    expect(prismaMock.party.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cpfCnpj: CPF, deletedAt: null } }),
    );
    const data = prismaMock.party.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: 'pf',
      cpfCnpj: CPF,
      legalName: 'Fulano',
      excludeFromPl: true,
      status: 'aprovado',
      riskLevel: 'baixo',
      pepFlag: false,
    });
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      created: true,
      document: CPF,
      cotistaId: COTISTA_ID,
      partyId: PARTY_ID,
      sha256: sha,
    });
    const uploadArg = uploadPartnerFile.mock.calls[0][0];
    expect(uploadArg.partnerId).toBe(PARTNER.id);
    expect(uploadArg.document).toBe(CPF);
    expect(uploadArg.fileName).toMatch(/^[0-9a-f-]{36}__Comprovante_Endereco\.pdf$/);
    const created = prismaMock.partnerDocument.create.mock.calls[0][0].data;
    expect(uploadArg.fileName.startsWith(`${created.id}__`)).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        action: 'partner.documents.upload',
        entityType: 'partner_document',
        entityId: created.id,
        ipAddress: '1.2.3.4',
        result: 'sucesso',
        details: { partnerId: PARTNER.id, partyId: PARTY_ID, cotistaId: COTISTA_ID, document: CPF },
      }),
    );
  });

  it('creates a pj party for a 14-digit document', async () => {
    prismaMock.party.findFirst.mockResolvedValue(null);
    prismaMock.party.create.mockResolvedValue({ id: PARTY_ID, cotista: { id: COTISTA_ID } });
    await upload({ document: '12345678000199' });
    expect(prismaMock.party.create.mock.calls[0][0].data.type).toBe('pj');
  });

  it('requires name when the party does not exist', async () => {
    prismaMock.party.findFirst.mockResolvedValue(null);
    await expect(upload({ name: undefined })).rejects.toMatchObject({ status: 400 });
    expect(uploadPartnerFile).not.toHaveBeenCalled();
  });

  it('reuses existing party and cotista on the second upload', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    const res = await upload();
    expect(prismaMock.party.create).not.toHaveBeenCalled();
    expect(prismaMock.cotista.create).not.toHaveBeenCalled();
    expect(res.body.partyId).toBe(PARTY_ID);
    expect(res.body.cotistaId).toBe(COTISTA_ID);
  });

  it('creates a cotista when the party has none', async () => {
    prismaMock.party.findFirst.mockResolvedValue({ ...partyWithCotista, cotista: null });
    prismaMock.cotista.create.mockResolvedValue({ id: COTISTA_ID });
    const res = await upload();
    expect(prismaMock.cotista.create).toHaveBeenCalledWith({ data: { partyId: PARTY_ID } });
    expect(res.body.cotistaId).toBe(COTISTA_ID);
  });

  it('rejects with 409 when cotistaId belongs to a different document', async () => {
    prismaMock.cotista.findUnique.mockResolvedValue({
      id: COTISTA_ID,
      party: { id: PARTY_ID, cpfCnpj: '99999999999', deletedAt: null },
    });
    await expect(upload({ cotistaId: COTISTA_ID })).rejects.toMatchObject({ status: 409 });
    expect(uploadPartnerFile).not.toHaveBeenCalled();
  });

  it('accepts cotistaId whose party matches the document', async () => {
    prismaMock.cotista.findUnique.mockResolvedValue({
      id: COTISTA_ID,
      party: { id: PARTY_ID, cpfCnpj: CPF, deletedAt: null },
    });
    const res = await upload({ cotistaId: COTISTA_ID });
    expect(res.status).toBe(201);
    expect(prismaMock.party.findFirst).not.toHaveBeenCalled();
  });

  it('dedups by sha256 without calling Mega', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findUnique.mockResolvedValue(docRow());
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.id).toBe(FILE_ID);
    expect(uploadPartnerFile).not.toHaveBeenCalled();
    expect(prismaMock.partnerDocument.create).not.toHaveBeenCalled();
    expect(prismaMock.partnerDocument.findUnique).toHaveBeenCalledWith({
      where: {
        partnerId_partyId_sha256: { partnerId: PARTNER.id, partyId: PARTY_ID, sha256: sha },
      },
    });
  });

  it.each([
    ['bad MIME', { mimeType: 'text/plain' }],
    ['oversized', { size: 12 * 1024 * 1024 + 1 }],
  ])('rejects %s with 400', async (_n, over) => {
    await expect(upload({ file: file(over) })).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.party.findFirst).not.toHaveBeenCalled();
    expect(uploadPartnerFile).not.toHaveBeenCalled();
  });

  it('rejects invalid document and long label with 400', async () => {
    await expect(upload({ document: '123' })).rejects.toMatchObject({ status: 400 });
    await expect(upload({ label: 'x'.repeat(121) })).rejects.toMatchObject({ status: 400 });
  });

  it('trims label', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    const res = await upload({ label: '  comprovante  ' });
    expect(res.body.label).toBe('comprovante');
  });

  it('maps Mega 502 and leaves no row', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    uploadPartnerFile.mockRejectedValue(new MegaError(502, 'Mega fora'));
    const err = await upload().catch((e) => e);
    expect(err).toBeInstanceOf(PartnerDocumentsError);
    expect(err.status).toBe(502);
    expect(prismaMock.partnerDocument.create).not.toHaveBeenCalled();
  });

  it('returns the winning row on unique race and cleans up Mega', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.create.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );
    prismaMock.partnerDocument.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(docRow({ id: 'winner-id', megaId: 'mega-w' }));
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.id).toBe('winner-id');
    expect(deletePartnerFile).toHaveBeenCalledWith('mega-1');
  });

  it('throws 500 and cleans up Mega on other insert failure', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.create.mockRejectedValue(new Error('db down'));
    deletePartnerFile.mockRejectedValue(new MegaError(502, 'cleanup falhou'));
    await expect(upload()).rejects.toMatchObject({ status: 500 });
    expect(deletePartnerFile).toHaveBeenCalledWith('mega-1');
  });
});

describe('listPartnerDocuments', () => {
  it('returns 404 without creating when cotista is missing', async () => {
    prismaMock.party.findFirst.mockResolvedValue(null);
    await expect(
      listPartnerDocuments({ partner: PARTNER, document: CPF, ip: null }),
    ).rejects.toMatchObject({ status: 404, message: 'Cotista não encontrado' });
    expect(prismaMock.party.create).not.toHaveBeenCalled();
  });

  it('filters by partnerId and omits mega fields', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findMany.mockResolvedValue([docRow()]);
    const res = await listPartnerDocuments({ partner: PARTNER, document: CPF, ip: '9.9.9.9' });
    expect(prismaMock.partnerDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partnerId: PARTNER.id, partyId: PARTY_ID } }),
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).not.toHaveProperty('megaId');
    expect(res.items[0].createdAt).toBe('2026-11-19T12:00:00.000Z');
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'partner.documents.list', entityId: PARTY_ID }),
    );
  });

  it('isolates by partner: other partner gets an empty list', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findMany.mockResolvedValue([]);
    const res = await listPartnerDocuments({ partner: OTHER_PARTNER, document: CPF, ip: null });
    expect(res.items).toEqual([]);
    expect(prismaMock.partnerDocument.findMany.mock.calls[0][0].where.partnerId).toBe('partner-2');
  });
});

describe('downloadPartnerDocument', () => {
  it('downloads from Mega scoped by partner', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findFirst.mockResolvedValue(docRow());
    downloadPartnerFile.mockResolvedValue(buffer);
    const res = await downloadPartnerDocument({
      partner: PARTNER,
      document: CPF,
      fileId: FILE_ID,
      ip: null,
    });
    expect(res).toEqual({ mimeType: 'application/pdf', originalName: 'a.pdf', buffer });
    expect(downloadPartnerFile).toHaveBeenCalledWith('mega-1');
    expect(prismaMock.partnerDocument.findFirst).toHaveBeenCalledWith({
      where: { id: FILE_ID, partnerId: PARTNER.id, partyId: PARTY_ID },
    });
  });

  it('returns 404 for a file of another partner', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findFirst.mockResolvedValue(null);
    await expect(
      downloadPartnerDocument({ partner: OTHER_PARTNER, document: CPF, fileId: FILE_ID, ip: null }),
    ).rejects.toMatchObject({ status: 404 });
    expect(downloadPartnerFile).not.toHaveBeenCalled();
  });
});

describe('deletePartnerDocument', () => {
  it('deletes Mega first and then the row', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findFirst.mockResolvedValue(docRow());
    const order: string[] = [];
    deletePartnerFile.mockImplementation(async () => void order.push('mega'));
    prismaMock.partnerDocument.deleteMany.mockImplementation(async () => void order.push('db'));
    const res = await deletePartnerDocument({
      partner: PARTNER,
      document: CPF,
      fileId: FILE_ID,
      ip: null,
    });
    expect(order).toEqual(['mega', 'db']);
    expect(res).toEqual({
      ok: true,
      id: FILE_ID,
      document: CPF,
      cotistaId: COTISTA_ID,
      partyId: PARTY_ID,
    });
    expect(prismaMock.partnerDocument.deleteMany).toHaveBeenCalledWith({
      where: { id: FILE_ID, partnerId: PARTNER.id },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'partner.documents.delete', entityId: FILE_ID }),
    );
  });

  it('isolates by partner: 404 and nothing deleted', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findFirst.mockResolvedValue(null);
    await expect(
      deletePartnerDocument({ partner: OTHER_PARTNER, document: CPF, fileId: FILE_ID, ip: null }),
    ).rejects.toMatchObject({ status: 404 });
    expect(deletePartnerFile).not.toHaveBeenCalled();
    expect(prismaMock.partnerDocument.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the row when Mega delete fails', async () => {
    prismaMock.party.findFirst.mockResolvedValue(partyWithCotista);
    prismaMock.partnerDocument.findFirst.mockResolvedValue(docRow());
    deletePartnerFile.mockRejectedValue(new MegaError(502, 'Mega fora'));
    await expect(
      deletePartnerDocument({ partner: PARTNER, document: CPF, fileId: FILE_ID, ip: null }),
    ).rejects.toMatchObject({ status: 502 });
    expect(prismaMock.partnerDocument.deleteMany).not.toHaveBeenCalled();
  });
});
