import { describe, expect, it } from 'vitest';
import { buildKycReportPdf } from './pdf.js';
import type { ComplianceDossier } from './types.js';

const fixture: ComplianceDossier = {
  meta: {
    document: '58426534000164',
    documentType: 'CNPJ',
    version: 1,
    generatedAt: '2026-09-09T12:00:00.000Z',
    completeness: 0.6,
    hash: 'sha256:abc',
  },
  subject: { type: 'PJ', legalName: 'IndexCore Asset Management', tradeName: null },
  risk: {
    level: 'medio',
    score: 40,
    factors: [{ code: 'PEP_FLAG', severity: 'alta', weight: 40, description: 'PEP identificado' }],
    complianceStatus: 'revisao_manual',
    blocked: false,
    requiresManualReview: true,
    recommendation: 'Encaminhar ao Compliance',
  },
  compliance: {
    status: 'revisao_manual',
    blocked: false,
    alerts: [{ type: 'pep', severity: 'alta' }],
  },
  sections: {
    cadastral: { cnpjStatus: 'ATIVA', cnae: '6630-4/00' },
    sanctions: { internationalHits: [] },
  },
  sources: [
    { providerSlug: 'mock-provider', consultedAt: '2026-09-09T12:00:00.000Z', cacheHit: true },
  ],
  audit: { requestedBy: 'admin', reportHash: 'sha256:abc' },
};

describe('buildKycReportPdf', () => {
  it('returns a PDF buffer', async () => {
    const buffer = await buildKycReportPdf(fixture);
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
  });
});
