import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadPartnerDocument: vi.fn(),
  listPartnerDocuments: vi.fn(),
  downloadPartnerDocument: vi.fn(),
  deletePartnerDocument: vi.fn(),
}));

vi.mock('../services/partner-documents.service.js', async () => {
  const actual = await vi.importActual<typeof import('../services/partner-documents.service.js')>(
    '../services/partner-documents.service.js',
  );
  return {
    ...actual,
    uploadPartnerDocument: mocks.uploadPartnerDocument,
    listPartnerDocuments: mocks.listPartnerDocuments,
    downloadPartnerDocument: mocks.downloadPartnerDocument,
    deletePartnerDocument: mocks.deletePartnerDocument,
  };
});

import { registerFimPartnerDocumentRoutes } from './fim-partner-documents.routes.js';
import { PartnerDocumentsError } from '../services/partner-documents.service.js';
import { MegaError } from '../lib/mega/client.js';
import type { AuthenticatedPartner } from '../services/partner.service.js';

let server: Server;
let baseUrl: string;

const FILE_ID = '11111111-1111-4111-8111-111111111111';
const DOC = '12345678901';
const BASE = `/v1/fim/shareholders/${DOC}/documents`;

function partner(scopes: string[]): AuthenticatedPartner {
  return { id: 'partner-1', name: 'Ipe Core', rateLimitRpm: 120, scopes };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerFimPartnerDocumentRoutes(app, {
    requirePartner(req, res, next) {
      const raw = req.header('x-test-partner');
      if (!raw) {
        res.status(401).json({ error: 'Token inválido ou ausente' });
        return;
      }
      (req as { partner?: AuthenticatedPartner }).partner = JSON.parse(raw) as AuthenticatedPartner;
      next();
    },
    logPartnerAccess(_req, _res, next) {
      next();
    },
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function call(path: string, init: RequestInit, scopes?: string[]) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(scopes ? { 'x-test-partner': JSON.stringify(partner(scopes)) } : {}),
      ...(init.headers ?? {}),
    },
  });
}

function uploadForm(
  opts: { file?: Blob | null; fileName?: string; fields?: Record<string, string> } = {},
) {
  const form = new FormData();
  const file =
    opts.file === undefined ? new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }) : opts.file;
  if (file) form.append('file', file, opts.fileName ?? 'comprovante.pdf');
  for (const [k, v] of Object.entries(opts.fields ?? {})) form.append(k, v);
  return form;
}

describe('FIM partner document routes', () => {
  it('rejects a missing token on every route', async () => {
    const post = await call(BASE, { method: 'POST', body: uploadForm() });
    const list = await call(BASE, { method: 'GET' });
    const get = await call(`${BASE}/${FILE_ID}`, { method: 'GET' });
    const del = await call(`${BASE}/${FILE_ID}`, { method: 'DELETE' });
    expect([post.status, list.status, get.status, del.status]).toEqual([401, 401, 401, 401]);
  });

  it('rejects POST and DELETE without the write scope', async () => {
    const post = await call(BASE, { method: 'POST', body: uploadForm() }, ['fim.documents.read']);
    const del = await call(`${BASE}/${FILE_ID}`, { method: 'DELETE' }, ['fim.documents.read']);
    expect(post.status).toBe(403);
    expect(del.status).toBe(403);
    expect(mocks.uploadPartnerDocument).not.toHaveBeenCalled();
    expect(mocks.deletePartnerDocument).not.toHaveBeenCalled();
  });

  it('rejects GET list and file without the read scope', async () => {
    const list = await call(BASE, { method: 'GET' }, ['fim.documents.write']);
    const get = await call(`${BASE}/${FILE_ID}`, { method: 'GET' }, ['fim.documents.write']);
    expect(list.status).toBe(403);
    expect(get.status).toBe(403);
    expect(mocks.listPartnerDocuments).not.toHaveBeenCalled();
    expect(mocks.downloadPartnerDocument).not.toHaveBeenCalled();
  });

  it('uploads with the write scope and returns 201 from the service', async () => {
    const body = { id: FILE_ID, created: true, document: DOC };
    mocks.uploadPartnerDocument.mockResolvedValue({ status: 201, body });
    const res = await call(
      BASE,
      {
        method: 'POST',
        body: uploadForm({ fields: { name: 'Maria', cotistaId: 'c-1', label: 'comprovante' } }),
      },
      ['fim.documents.write'],
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(body);
    const input = mocks.uploadPartnerDocument.mock.calls[0]![0];
    expect(input).toMatchObject({
      partner: { id: 'partner-1', name: 'Ipe Core' },
      document: DOC,
      name: 'Maria',
      cotistaId: 'c-1',
      label: 'comprovante',
      file: { originalName: 'comprovante.pdf', mimeType: 'application/pdf' },
    });
    expect(Buffer.isBuffer(input.file.buffer)).toBe(true);
  });

  it('propagates 200 for a deduplicated upload', async () => {
    mocks.uploadPartnerDocument.mockResolvedValue({
      status: 200,
      body: { id: FILE_ID, created: false },
    });
    const res = await call(BASE, { method: 'POST', body: uploadForm() }, ['fim.documents.write']);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { created: boolean }).created).toBe(false);
  });

  it('returns 400 when the file field is missing', async () => {
    const res = await call(BASE, { method: 'POST', body: uploadForm({ file: null }) }, [
      'fim.documents.write',
    ]);
    expect(res.status).toBe(400);
    expect(mocks.uploadPartnerDocument).not.toHaveBeenCalled();
  });

  it('maps PartnerDocumentsError and MegaError to their status', async () => {
    mocks.uploadPartnerDocument.mockRejectedValueOnce(
      new PartnerDocumentsError(400, 'Tipo de arquivo não permitido'),
    );
    const bad = await call(BASE, { method: 'POST', body: uploadForm() }, ['fim.documents.write']);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Tipo de arquivo não permitido' });

    mocks.uploadPartnerDocument.mockRejectedValueOnce(new MegaError(502, 'Mega indisponível'));
    const mega = await call(BASE, { method: 'POST', body: uploadForm() }, ['fim.documents.write']);
    expect(mega.status).toBe(502);
    expect(await mega.json()).toEqual({ error: 'Mega indisponível' });
  });

  it('lists documents with the optional cotistaId query', async () => {
    const payload = { document: DOC, items: [] };
    mocks.listPartnerDocuments.mockResolvedValue(payload);
    const res = await call(`${BASE}?cotistaId=c-1`, { method: 'GET' }, ['fim.documents.read']);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(mocks.listPartnerDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ document: DOC, cotistaId: 'c-1', partner: { id: 'partner-1' } }),
    );
  });

  it('downloads as attachment by default and inline on request', async () => {
    mocks.downloadPartnerDocument.mockResolvedValue({
      mimeType: 'application/pdf',
      originalName: 'comprovante.pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    });
    const attachment = await call(`${BASE}/${FILE_ID}`, { method: 'GET' }, ['fim.documents.read']);
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get('content-type')).toBe('application/pdf');
    expect(attachment.headers.get('content-disposition')).toMatch(
      /^attachment; filename="comprovante\.pdf"/,
    );
    expect(await attachment.text()).toBe('%PDF-1.4 test');

    const inline = await call(`${BASE}/${FILE_ID}?disposition=inline`, { method: 'GET' }, [
      'fim.documents.read',
    ]);
    expect(inline.headers.get('content-disposition')).toMatch(/^inline; /);
  });

  it('deletes a document and then returns 404 on the next GET', async () => {
    mocks.deletePartnerDocument.mockResolvedValue({
      ok: true,
      id: FILE_ID,
      document: DOC,
      cotistaId: 'c-1',
      partyId: 'p-1',
    });
    mocks.downloadPartnerDocument.mockRejectedValue(
      new PartnerDocumentsError(404, 'Documento não encontrado'),
    );
    const del = await call(`${BASE}/${FILE_ID}`, { method: 'DELETE' }, ['fim.documents.write']);
    expect(del.status).toBe(200);
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true);

    const get = await call(`${BASE}/${FILE_ID}`, { method: 'GET' }, ['fim.documents.read']);
    expect(get.status).toBe(404);
    expect(await get.json()).toEqual({ error: 'Documento não encontrado' });
  });
});
