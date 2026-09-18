/**
 * Smoke: upload + view documentos (FIM/Mega + DocumentUpload local).
 * Uso: NODE_ENV=development npm run smoke:docs
 *
 * Pré-requisitos: Postgres local, nextcorefim :3002 + Mega, API_SERVICE_KEY alinhada.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/db/index.js';
import { env } from '../src/lib/env.js';
import { NextcorefimApiClient, NextcorefimApiError } from '../src/lib/nextcorefim/client.js';
import {
  getFimDocumentsForCotista,
  uploadFimDocumentForCotista,
  downloadFimDocumentForCotista,
} from '../src/lib/nextcorefim/fim-documents.js';
import {
  confirmDocumentUpload,
  getDocumentUploadUrl,
  listDocumentsByParty,
} from '../src/services/document.service.js';
import { keyFromFileUri, saveFile } from '../src/lib/storage.js';
import { generateDocFixtures } from './generate-doc-fixtures.js';
import { ensureFimDevCotista } from './seed-fim-cotista.js';

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];

function assert(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Assertion failed: ${name}${detail ? ` — ${detail}` : ''}`);
}

function buildMultipart(slot: string, fileName: string, mime: string, file: Buffer) {
  const boundary = `----OpCoreSmoke${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];
  const push = (s: string | Buffer) => chunks.push(typeof s === 'string' ? Buffer.from(s) : s);

  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="slot"\r\n\r\n${slot}\r\n`);
  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`);
  push(`Content-Type: ${mime}\r\n\r\n`);
  push(file);
  push(`\r\n--${boundary}--\r\n`);

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

async function smokeLocalDocumentUpload(
  partyId: string,
  userId: string,
  filePath: string,
  mime: string,
  type: 'rg' | 'contrato_social',
  label: string,
) {
  const bytes = readFileSync(filePath);
  assert(`${label}: fixture bytes > 0`, bytes.length > 0, String(bytes.length));

  const { uploadUrl, documentId } = await getDocumentUploadUrl(
    {
      partyId,
      type,
      mimeType: mime,
      fileName: filePath.split('/').pop() ?? 'doc',
    },
    userId,
  );
  assert(`${label}: uploadUrl`, uploadUrl.includes('/files/upload/'));

  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const key = keyFromFileUri(doc.fileUri);
  await saveFile(key, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const confirmed = await confirmDocumentUpload(documentId, hash, userId);
  assert(`${label}: status em_analise`, confirmed.status === 'em_analise', confirmed.status);

  const listed = await listDocumentsByParty(partyId, [], true);
  assert(
    `${label}: listagem contém doc`,
    listed.some((d) => d.id === documentId),
  );
}

async function main() {
  console.log('\n=== Smoke document uploads (OpCore Admin) ===\n');
  console.log(`NEXTCOREFIM_API_URL=${env.nextcorefimApiUrl}`);

  const fixtures = generateDocFixtures();
  assert('fixtures: PDF', readFileSync(fixtures.pdf).length > 20);
  assert('fixtures: PNG', readFileSync(fixtures.png).length > 20);
  assert('fixtures: JPG', readFileSync(fixtures.jpg).length > 20);
  assert('fixtures: DOCX', readFileSync(fixtures.docx).length > 20);

  const admin = await prisma.user.findFirst({ where: { isAdmin: true } });
  assert('seed: admin user', !!admin, admin?.email);

  const fim = await ensureFimDevCotista();
  assert('FIM cotista criado', !!fim.cotistaId, fim.cotistaId);
  assert('FIM applicationId', !!fim.applicationId, fim.applicationId);

  const checklist = await getFimDocumentsForCotista(fim.cotistaId, [], true);
  assert('FIM checklist slots', checklist.slots.length > 0, String(checklist.slots.length));

  const pdf = readFileSync(fixtures.pdf);
  const png = readFileSync(fixtures.png);

  const pdfMp = buildMultipart('identidade', 'sample.pdf', 'application/pdf', pdf);
  const afterPdf = await uploadFimDocumentForCotista(fim.cotistaId, pdfMp.contentType, pdfMp.body);
  const idSlot = afterPdf.slots.find((s) => s.key === 'identidade');
  assert('FIM upload PDF identidade', (idSlot?.files.length ?? 0) > 0);
  const pdfDocId = idSlot!.files[idSlot!.files.length - 1]!.id;

  const pngMp = buildMultipart('comprovante-endereco', 'sample.png', 'image/png', png);
  const afterPng = await uploadFimDocumentForCotista(fim.cotistaId, pngMp.contentType, pngMp.body);
  const addrSlot = afterPng.slots.find((s) => s.key === 'comprovante-endereco');
  assert('FIM upload PNG comprovante', (addrSlot?.files.length ?? 0) > 0);
  const pngDocId = addrSlot!.files[addrSlot!.files.length - 1]!.id;

  const pdfDl = await downloadFimDocumentForCotista(fim.cotistaId, pdfDocId, 'inline');
  const pdfBuf = Buffer.from(await pdfDl.arrayBuffer());
  assert('FIM view PDF bytes > 0', pdfBuf.length > 0, String(pdfBuf.length));
  assert(
    'FIM view PDF Content-Type',
    (pdfDl.headers.get('content-type') ?? '').includes('pdf') || pdfBuf[0] === 0x25,
    pdfDl.headers.get('content-type') ?? 'n/a',
  );

  const pngDl = await downloadFimDocumentForCotista(fim.cotistaId, pngDocId, 'attachment');
  const pngBuf = Buffer.from(await pngDl.arrayBuffer());
  assert('FIM download PNG bytes > 0', pngBuf.length > 0, String(pngBuf.length));

  await smokeLocalDocumentUpload(
    fim.partyId,
    admin!.id,
    fixtures.pdf,
    'application/pdf',
    'rg',
    'Onboarding cotista PDF',
  );
  await smokeLocalDocumentUpload(
    fim.partyId,
    admin!.id,
    fixtures.docx,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'rg',
    'Onboarding cotista DOCX',
  );

  const cedenteCnpj = '11222333000181';
  const cedenteParty = await prisma.party.upsert({
    where: { cpfCnpj: cedenteCnpj },
    update: { legalName: 'Cedente Docs Dev', status: 'aprovado' },
    create: {
      type: 'pj',
      cpfCnpj: cedenteCnpj,
      legalName: 'Cedente Docs Dev',
      status: 'aprovado',
      riskLevel: 'baixo',
      approvedAt: new Date(),
    },
  });
  await prisma.cedente.upsert({
    where: { partyId: cedenteParty.id },
    update: {},
    create: { partyId: cedenteParty.id },
  });
  await smokeLocalDocumentUpload(
    cedenteParty.id,
    admin!.id,
    fixtures.pdf,
    'application/pdf',
    'contrato_social',
    'Onboarding cedente PDF',
  );

  const failing = new NextcorefimApiClient(async () => {
    throw new TypeError('fetch failed');
  });
  try {
    await failing.listDocuments('any');
    assert('FIM down: deveria lançar', false);
  } catch (err) {
    assert(
      'FIM down: NextcorefimApiError 503',
      err instanceof NextcorefimApiError && err.status === 503,
      err instanceof Error ? err.message : String(err),
    );
    assert(
      'FIM down: mensagem PT',
      err instanceof Error && err.message.includes('indisponível'),
      err instanceof Error ? err.message : '',
    );
  }

  console.log(
    `\n=== Smoke docs: ${results.filter((r) => r.ok).length}/${results.length} PASS ===\n`,
  );
}

main()
  .catch((err) => {
    console.error('\nSmoke docs falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
