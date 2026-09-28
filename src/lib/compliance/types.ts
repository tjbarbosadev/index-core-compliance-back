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

export type BillingVendor = 'bigdatacorp' | 'lemit' | 'apollo';

export type ProviderBillingStatus =
  | 'ok'
  | 'low_balance'
  | 'payment_issue'
  | 'ip_blocked'
  | 'unauthorized'
  | 'not_configured'
  | 'no_api'
  | 'error';

export interface ProviderBillingCard {
  vendor: BillingVendor;
  name: string;
  status: ProviderBillingStatus;
  statusMessage: string | null;
  checkedAt: string;
  billingModel: string;
  portalUrl: string;
  howToPay: string[];
  monthUsage: { requests: number; credits: number | null };
  lemit?: { saldo: number | null; consumo: number | null };
  apollo?: {
    rateLimits: Array<{
      endpoint: string;
      window: 'minute' | 'hour' | 'day';
      limit: number | null;
      consumed: number | null;
      leftOver: number | null;
    }>;
  };
  bigdatacorp?: {
    requests: number;
    grossBrl: number;
    discount: number;
    estimatedBrl: number;
    unpricedRequests: number;
    bySlug: Array<{ slug: string; requests: number; unitBrl: number | null; grossBrl: number }>;
  };
}

export interface ProviderBillingOverview {
  generatedAt: string;
  monthStart: string;
  providers: ProviderBillingCard[];
}
