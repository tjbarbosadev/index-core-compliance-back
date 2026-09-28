import type { DocumentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, downloadZapSignFile, sendCedenteStageEmail, logAudit, saveFile } = vi.hoisted(
  () => {
    const prismaMock = {
      onboardingProcess: { findFirst: vi.fn(), update: vi.fn() },
      onboardingStep: { updateMany: vi.fn() },
      signatureEnvelope: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        count: vi.fn(),
      },
      document: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      legalReview: { findFirst: vi.fn(), findMany: vi.fn() },
      party: { update: vi.fn() },
      $transaction: vi.fn(),
    };
    prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock));
    return {
      prismaMock,
      downloadZapSignFile: vi.fn(),
      sendCedenteStageEmail: vi.fn(),
      logAudit: vi.fn(),
      saveFile: vi.fn(),
    };
  },
);

vi.mock('../db/index.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/env.js', () => ({
  env: { webUrl: 'https://admin.example', zapsignSandbox: true },
}));
vi.mock('./audit.service.js', () => ({ logAudit }));
vi.mock('./email.service.js', () => ({ sendCedenteStageEmail }));
vi.mock('./onboarding.service.js', () => ({
  applyKycScreening: vi.fn(),
  createOnboarding: vi.fn(),
}));
vi.mock('../lib/storage.js', () => ({
  buildObjectKey: vi.fn(),
  fileUriForKey: vi.fn(),
  getAbsolutePath: vi.fn(),
  keyFromFileUri: vi.fn((uri: string) => uri.replace('local://', '')),
  saveFile,
}));
vi.mock('../lib/zapsign/client.js', () => ({
  createZapSignDocument: vi.fn(),
  downloadZapSignFile,
  getZapSignDocument: vi.fn(),
}));
vi.mock('../lib/cedente/pdf/docx-to-pdf.js', () => ({ docxToPdf: vi.fn() }));
vi.mock('../lib/cedente/pdf/legal-opinion.js', () => ({ buildLegalOpinionPdf: vi.fn() }));

import {
  cedenteFormFixture,
  empresaFixture,
  estruturaFixture,
} from '../lib/cedente/cedente-form.fixture.js';
import { buildCedenteDocumentCatalog } from '../lib/cedente/document-catalog.js';
import {
  applyZapSignDocumentState,
  approveCedenteOnboarding,
  currentDocumentsBySlot,
  documentsBlockingApproval,
  hashForm,
  submitLegalReview,
} from './cedente-onboarding.service.js';

const processId = '33333333-3333-4333-8333-333333333333';
const partyId = '11111111-1111-4111-8111-111111111111';
const actor = { userId: 'user-compliance' };

function mockProcess(overrides: Record<string, unknown> = {}) {
  prismaMock.onboardingProcess.findFirst.mockResolvedValue({
    id: processId,
    kind: 'cedente',
    partyId,
    currentStep: 7,
    cedenteStage: 'em_analise_compliance',
    stepDataJson: {
      pj: { empresa: empresaFixture, estrutura: estruturaFixture },
      kyc: { pepFlag: false, restrictiveListHit: false },
      aml: { lawfulOriginDeclared: true },
    },
    party: { id: partyId, legalName: 'Cedente Teste LTDA', cpfCnpj: '11222333000181' },
    ...overrides,
  });
}

function doc(slot: string, status: DocumentStatus, createdAt = new Date('2026-09-01'), hash = 'h') {
  return { id: `${slot}-${createdAt.getTime()}`, slot, status, hashSha256: hash, createdAt };
}

function approvedDocsForFixture() {
  return buildCedenteDocumentCatalog(cedenteFormFixture)
    .filter((s) => s.required)
    .map((s) => doc(s.key, 'aprovado'));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock));
});

describe('hashForm', () => {
  it('ignores key order at every level', () => {
    expect(hashForm({ a: 1, b: { x: 1, y: 2 } })).toBe(hashForm({ b: { y: 2, x: 1 }, a: 1 }));
  });

  it('changes when a nested list item changes', () => {
    const changed = {
      ...cedenteFormFixture,
      contasBancarias: [{ ...estruturaFixture.contasBancarias[0], contaCorrente: '999999' }],
    };
    expect(hashForm(changed)).not.toBe(hashForm(cedenteFormFixture));
  });
});

describe('currentDocumentsBySlot', () => {
  it('keeps the latest confirmed upload per slot', () => {
    const older = doc('dre', 'rejeitado', new Date('2026-09-01'));
    const newer = doc('dre', 'em_analise', new Date('2026-09-10'));
    const inFlight = doc('dre', 'pendente', new Date('2026-09-20'), '');
    const current = currentDocumentsBySlot([older, inFlight, newer]);
    expect(current.get('dre')).toBe(newer);
  });
});

describe('documentsBlockingApproval', () => {
  const catalog = buildCedenteDocumentCatalog(cedenteFormFixture);

  it('is empty when every required document is approved', () => {
    expect(
      documentsBlockingApproval(catalog, currentDocumentsBySlot(approvedDocsForFixture())),
    ).toEqual([]);
  });

  it('lists missing required and non-approved documents with readable status', () => {
    const docs = approvedDocsForFixture().filter((d) => d.slot !== 'dre');
    docs.push(doc('certidoes', 'rejeitado'));
    const blocking = documentsBlockingApproval(catalog, currentDocumentsBySlot(docs));
    expect(blocking).toEqual([
      'Demonstração do Resultado do Exercício (DRE) (ausente)',
      'Certidões negativas (federal, estadual, trabalhista) (recusado)',
    ]);
  });
});

describe('submitLegalReview guards', () => {
  it('only runs while awaiting the legal review', async () => {
    mockProcess({ cedenteStage: 'rascunho' });
    await expect(
      submitLegalReview(processId, { decision: 'pendencia', opinion: 'Parecer de teste' }, actor),
    ).rejects.toThrow(/não permitido na etapa "Rascunho"/);
  });

  it('requires pending items for a pendência', async () => {
    mockProcess({ cedenteStage: 'em_analise_juridica' });
    await expect(
      submitLegalReview(
        processId,
        { decision: 'pendencia', opinion: 'Parecer de teste', pendingItems: ['  '] },
        actor,
      ),
    ).rejects.toThrow('Liste as pendências');
  });

  it('blocks a favorable opinion while documents are not approved', async () => {
    mockProcess({ cedenteStage: 'em_analise_juridica' });
    prismaMock.document.findMany.mockResolvedValue([doc('contrato-social', 'em_analise')]);
    await expect(
      submitLegalReview(processId, { decision: 'favoravel', opinion: 'Parecer de teste' }, actor),
    ).rejects.toThrow(
      /Valide todos os documentos.*Último contrato social consolidado \(em análise\)/,
    );
  });
});

describe('approveCedenteOnboarding guards', () => {
  it('requires a justification', async () => {
    await expect(approveCedenteOnboarding(processId, '  ', actor)).rejects.toThrow(
      'Justificativa de aprovação é obrigatória',
    );
  });

  it('requires KYC/AML first', async () => {
    mockProcess({ currentStep: 6, stepDataJson: { pj: {} } });
    await expect(approveCedenteOnboarding(processId, 'ok', actor)).rejects.toThrow(
      'Registre o KYC/AML antes de aprovar',
    );
  });

  it('requires the latest legal opinion to be favorable', async () => {
    mockProcess();
    prismaMock.legalReview.findFirst.mockResolvedValue({ decision: 'pendencia' });
    await expect(approveCedenteOnboarding(processId, 'ok', actor)).rejects.toThrow(
      'Aprovação exige parecer jurídico favorável',
    );
  });

  it('forbids the legal reviewer from approving (segregation of duties)', async () => {
    mockProcess();
    prismaMock.legalReview.findFirst.mockResolvedValue({ decision: 'favoravel' });
    prismaMock.legalReview.findMany.mockResolvedValue([{ reviewerId: actor.userId }]);
    await expect(approveCedenteOnboarding(processId, 'ok', actor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringMatching(/Segregação de funções/),
    });
  });

  it('blocks approval while documents are pending', async () => {
    mockProcess();
    prismaMock.legalReview.findFirst.mockResolvedValue({ decision: 'favoravel' });
    prismaMock.legalReview.findMany.mockResolvedValue([{ reviewerId: 'user-juridico' }]);
    prismaMock.document.findMany.mockResolvedValue([]);
    await expect(approveCedenteOnboarding(processId, 'ok', actor)).rejects.toThrow(
      /Documentos não aprovados/,
    );
  });
});

describe('applyZapSignDocumentState', () => {
  function mockEnvelope(overrides: Record<string, unknown> = {}) {
    prismaMock.signatureEnvelope.findUnique.mockResolvedValue({
      id: 'env-1',
      onboardingId: processId,
      documentId: 'doc-1',
      status: 'pendente',
      onboarding: {
        cedenteStage: 'aguardando_assinatura',
        party: { legalName: 'Cedente Teste LTDA' },
      },
      ...overrides,
    });
  }

  it('ignores events without token or for unknown envelopes', async () => {
    expect(await applyZapSignDocumentState({})).toEqual({
      handled: false,
      reason: 'missing_token',
    });
    prismaMock.signatureEnvelope.findUnique.mockResolvedValue(null);
    expect(await applyZapSignDocumentState({ token: 'x' })).toEqual({
      handled: false,
      reason: 'unknown_envelope',
    });
  });

  it('is idempotent for envelopes already processed', async () => {
    mockEnvelope({ status: 'assinado' });
    await applyZapSignDocumentState({ token: 'tok', status: 'signed', signed_file: 'https://s3' });
    expect(downloadZapSignFile).not.toHaveBeenCalled();
    expect(prismaMock.signatureEnvelope.update).not.toHaveBeenCalled();
  });

  it('stores the signed PDF and moves to legal review when the last envelope is signed', async () => {
    mockEnvelope();
    downloadZapSignFile.mockResolvedValue(Buffer.from('%PDF-signed'));
    prismaMock.document.findUnique.mockResolvedValue({
      id: 'doc-1',
      fileUri: 'local://parties/doc-1.pdf',
      fileName: 'ficha-cadastral-pj.pdf',
    });
    prismaMock.signatureEnvelope.count.mockResolvedValue(0);

    await applyZapSignDocumentState({ token: 'tok', status: 'signed', signed_file: 'https://s3' });

    expect(saveFile).toHaveBeenCalledWith('parties/doc-1.pdf', Buffer.from('%PDF-signed'));
    expect(prismaMock.document.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileName: 'ficha-cadastral-pj-assinado.pdf' }),
      }),
    );
    expect(prismaMock.signatureEnvelope.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'assinado' }) }),
    );
    expect(prismaMock.onboardingProcess.update).toHaveBeenCalledWith({
      where: { id: processId },
      data: { cedenteStage: 'em_analise_juridica', currentStep: 5 },
    });
    expect(sendCedenteStageEmail).toHaveBeenCalled();
  });

  it('waits for the remaining envelopes before moving on', async () => {
    mockEnvelope();
    downloadZapSignFile.mockResolvedValue(Buffer.from('%PDF'));
    prismaMock.document.findUnique.mockResolvedValue(null);
    prismaMock.signatureEnvelope.count.mockResolvedValue(2);
    await applyZapSignDocumentState({ token: 'tok', status: 'signed', signed_file: 'https://s3' });
    expect(prismaMock.onboardingProcess.update).not.toHaveBeenCalled();
  });

  it('returns the process to draft when a signer refuses', async () => {
    mockEnvelope();
    await applyZapSignDocumentState({ token: 'tok', status: 'refused' });
    expect(prismaMock.signatureEnvelope.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'recusado' }) }),
    );
    expect(prismaMock.signatureEnvelope.updateMany).toHaveBeenCalledWith({
      where: { onboardingId: processId, status: 'pendente' },
      data: { status: 'cancelado' },
    });
    expect(prismaMock.onboardingProcess.update).toHaveBeenCalledWith({
      where: { id: processId },
      data: { cedenteStage: 'rascunho', currentStep: 4 },
    });
  });
});
