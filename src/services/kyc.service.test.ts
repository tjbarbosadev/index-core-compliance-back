import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

const prismaMock = {
  onboardingProcess: { findUnique: vi.fn() },
  party: { findUnique: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(),
  kycReport: {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  complianceAlert: { create: vi.fn() },
};

vi.mock('../db/index.js', () => ({ prisma: prismaMock }));
vi.mock('./audit.service.js', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/storage.js', () => ({
  saveFile: vi.fn(),
  fileUriForKey: (key: string) => `local://${key}`,
  getAbsolutePath: (key: string) => `/tmp/${key}`,
}));
vi.mock('../lib/compliance/pdf.js', () => ({
  buildKycReportPdf: vi.fn(async () => Buffer.from('%PDF-mock')),
}));

const getDossier = vi.fn();
vi.mock('../lib/compliance/client.js', () => ({
  ComplianceApiError: class ComplianceApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = 'ComplianceApiError';
    }
  },
  complianceApiClient: { getDossier },
}));

describe('kyc.service generateKycReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.kycReport.create.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      document: '58426534000164',
      documentType: 'CNPJ',
    });
    prismaMock.kycReport.update.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      document: '58426534000164',
      documentType: 'CNPJ',
      partyId: '22222222-2222-2222-2222-222222222222',
      onboardingId: null,
      riskLevel: 'alto',
      complianceStatus: 'revisao_manual',
      blocked: false,
      dossierJson: {},
      reportHash: 'sha256:x',
      pdfUri: 'local://kyc-reports/11111111-1111-1111-1111-111111111111.pdf',
      createdById: '33333333-3333-3333-3333-333333333333',
      createdAt: new Date('2026-09-09T12:00:00Z'),
      party: {
        id: '22222222-2222-2222-2222-222222222222',
        legalName: 'IndexCore',
        cpfCnpj: '58426534000164',
      },
      createdBy: {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Admin',
        email: 'admin@indexcore.local',
      },
    });
    prismaMock.party.findUnique.mockResolvedValue({ id: '22222222-2222-2222-2222-222222222222' });
    prismaMock.party.update.mockResolvedValue({});
    prismaMock.complianceAlert.create.mockResolvedValue({});
  });

  it('persists report and updates party riskLevel', async () => {
    getDossier.mockResolvedValue({
      meta: {
        document: '58426534000164',
        documentType: 'CNPJ',
        version: 1,
        generatedAt: '2026-09-09T12:00:00Z',
        completeness: 0.5,
        hash: 'sha256:x',
      },
      subject: { type: 'PJ', legalName: 'IndexCore', tradeName: null },
      risk: {
        level: 'alto',
        score: 70,
        factors: [],
        complianceStatus: 'revisao_manual',
        blocked: false,
        requiresManualReview: true,
        recommendation: null,
      },
      compliance: { status: 'revisao_manual', blocked: false, alerts: [] },
      sections: { pldft: { isPep: true, restrictiveListHits: [] } },
      sources: [],
      audit: { requestedBy: 'u', reportHash: 'sha256:x' },
    });

    const { generateKycReport } = await import('./kyc.service.js');
    const result = await generateKycReport(
      {
        document: '58.426.534/0001-64',
        documentType: 'CNPJ',
        partyId: '22222222-2222-2222-2222-222222222222',
      },
      '33333333-3333-3333-3333-333333333333',
    );

    expect(result.riskLevel).toBe('alto');
    expect(prismaMock.kycReport.create).toHaveBeenCalled();
    expect(prismaMock.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ riskLevel: 'alto', pepFlag: true }),
      }),
    );
    expect(prismaMock.complianceAlert.create).toHaveBeenCalled();
  });

  it('creates alerts from dossier.compliance.alerts and blocked without party', async () => {
    prismaMock.kycReport.update.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      document: '58426534000164',
      documentType: 'CNPJ',
      partyId: null,
      onboardingId: null,
      riskLevel: 'muito_alto',
      complianceStatus: 'rejeitado',
      blocked: true,
      dossierJson: {},
      reportHash: 'sha256:x',
      pdfUri: 'local://kyc-reports/11111111-1111-1111-1111-111111111111.pdf',
      createdById: '33333333-3333-3333-3333-333333333333',
      createdAt: new Date('2026-09-09T12:00:00Z'),
      party: null,
      createdBy: {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Admin',
        email: 'admin@indexcore.local',
      },
    });

    getDossier.mockResolvedValue({
      meta: {
        document: '58426534000164',
        documentType: 'CNPJ',
        version: 1,
        generatedAt: '2026-09-09T12:00:00Z',
        completeness: 0.5,
        hash: 'sha256:x',
      },
      subject: { type: 'PJ', legalName: 'IndexCore', tradeName: null },
      risk: {
        level: 'muito_alto',
        score: 95,
        factors: [],
        complianceStatus: 'rejeitado',
        blocked: true,
        requiresManualReview: true,
        recommendation: 'Recusar',
      },
      compliance: {
        status: 'rejeitado',
        blocked: true,
        alerts: [
          { type: 'pj_sanctioned', severity: 'alta' },
          { type: 'collections_presence', severity: 'media' },
        ],
      },
      sections: {},
      sources: [],
      audit: { requestedBy: 'u', reportHash: 'sha256:x' },
    });

    const { generateKycReport } = await import('./kyc.service.js');
    await generateKycReport(
      { document: '58426534000164', documentType: 'CNPJ' },
      '33333333-3333-3333-3333-333333333333',
    );

    expect(prismaMock.party.update).not.toHaveBeenCalled();
    expect(prismaMock.complianceAlert.create).toHaveBeenCalled();
    const types = prismaMock.complianceAlert.create.mock.calls.map(
      (c) => (c[0] as { data: { type: string } }).data.type,
    );
    expect(types).toContain('lista_restritiva');
    expect(types).toContain('outro');
    expect(new Set(types).size).toBe(types.length);
  });

  it('maps missing service key to PRECONDITION_FAILED', async () => {
    const { ComplianceApiError } = await import('../lib/compliance/client.js');
    getDossier.mockRejectedValue(
      new ComplianceApiError('COMPLIANCE_API_SERVICE_KEY não configurada', 500),
    );
    const { generateKycReport } = await import('./kyc.service.js');
    await expect(
      generateKycReport(
        { document: '58426534000164', documentType: 'CNPJ' },
        '33333333-3333-3333-3333-333333333333',
      ),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
