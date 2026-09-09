export type ComplianceDocumentType = 'CPF' | 'CNPJ';

export type RiskLevel = 'baixo' | 'medio' | 'alto' | 'muito_alto';

export interface RiskFactor {
  code: string;
  severity: string;
  weight: number;
  description: string;
}

export interface RiskAssessmentResult {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  complianceStatus: string;
  blocked: boolean;
  requiresManualReview: boolean;
  recommendation: string | null;
}

export interface ComplianceAlert {
  type: string;
  severity: string;
}

export interface ComplianceVerdict {
  status: string;
  blocked: boolean;
  alerts: ComplianceAlert[];
}

export interface DossierMeta {
  dossierId?: string;
  document: string;
  documentType: ComplianceDocumentType;
  version: number;
  generatedAt: string;
  completeness: number;
  hash: string;
}

export interface DossierSource {
  providerSlug: string;
  consultedAt: string;
  cacheHit: boolean;
}

export interface DossierAudit {
  requestedBy: string | null;
  reportHash: string;
}

export interface PfSubject {
  type: 'PF';
  fullName: string | null;
}

export interface PjSubject {
  type: 'PJ';
  legalName: string | null;
  tradeName: string | null;
}

export interface ComplianceDossier {
  meta: DossierMeta;
  subject: PfSubject | PjSubject;
  risk: RiskAssessmentResult;
  compliance: ComplianceVerdict;
  sections: Record<string, unknown>;
  sources: DossierSource[];
  audit: DossierAudit;
}

export interface ConsultResult {
  document: string;
  documentType: ComplianceDocumentType;
  provider?: { slug: string };
  source?: 'cache' | 'provider';
  payload?: { sections?: Record<string, unknown> };
  cacheHit?: boolean;
  cachedAt?: string | null;
}

export interface GetDossierParams {
  document: string;
  documentType: ComplianceDocumentType;
  forceRefresh?: boolean;
  providerSlug?: string;
  requestedBy?: string;
}
