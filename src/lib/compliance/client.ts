import { env } from '../env.js';
import type {
  ComplianceDossier,
  ConsultResult,
  GetDossierParams,
  RiskAssessmentResult,
} from './types.js';

type FetchFn = typeof fetch;

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function parseExpiresIn(value: string): number {
  const match = /^(\d+)([smhd])$/i.exec(value.trim());
  if (!match) return 7 * 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * (multipliers[unit] ?? multipliers.h);
}

export class ComplianceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ComplianceApiError';
  }
}

export class ComplianceApiClient {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  private baseUrl(): string {
    return env.complianceApiUrl.replace(/\/$/, '');
  }

  resetTokenCache(): void {
    tokenCache = null;
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.expiresAt > now + 30_000) {
      return tokenCache.token;
    }

    const apiKey = env.complianceApiServiceKey;
    if (!apiKey) {
      throw new ComplianceApiError('COMPLIANCE_API_SERVICE_KEY não configurada', 500);
    }

    const response = await this.fetchFn(`${this.baseUrl()}/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        sub: env.complianceApiSub,
        service: env.complianceApiService,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `Falha ao autenticar na API de compliance (${response.status})`;
      throw new ComplianceApiError(message, response.status, body);
    }

    const token =
      body && typeof body === 'object' && 'token' in body
        ? String((body as { token: unknown }).token)
        : '';
    if (!token) {
      throw new ComplianceApiError('Resposta de token inválida', 502, body);
    }

    const expiresIn =
      body && typeof body === 'object' && 'expiresIn' in body
        ? String((body as { expiresIn: unknown }).expiresIn)
        : '8h';
    tokenCache = {
      token,
      expiresAt: now + parseExpiresIn(expiresIn) - 60_000,
    };
    return token;
  }

  private static readonly LONG_TIMEOUT_MS = 5 * 60 * 1000;

  private async request<T>(
    path: string,
    init: RequestInit = {},
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const token = await this.getToken();
    const timeoutMs = options?.timeoutMs;
    const controller = timeoutMs != null ? new AbortController() : null;
    const timer =
      controller && timeoutMs != null ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await this.fetchFn(`${this.baseUrl()}${path}`, {
        ...init,
        signal: controller?.signal ?? init.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 204) {
        return undefined as T;
      }

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : `Erro na API de compliance (${response.status})`;
        throw new ComplianceApiError(message, response.status, body);
      }
      return body as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ComplianceApiError(
          `Timeout na API de compliance após ${Math.round((timeoutMs ?? 0) / 1000)}s`,
          504,
        );
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  consult(input: {
    document: string;
    documentType: 'CPF' | 'CNPJ';
    providerSlug?: string;
    forceRefresh?: boolean;
  }): Promise<ConsultResult> {
    return this.request<ConsultResult>(
      '/v1/compliance/consult',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
      { timeoutMs: ComplianceApiClient.LONG_TIMEOUT_MS },
    );
  }

  getDossier(params: GetDossierParams): Promise<ComplianceDossier> {
    const search = new URLSearchParams();
    search.set('documentType', params.documentType);
    if (params.forceRefresh) search.set('forceRefresh', 'true');
    if (params.providerSlug) search.set('providerSlug', params.providerSlug);
    const qs = search.toString();
    const encoded = encodeURIComponent(params.document);
    return this.request<ComplianceDossier>(
      `/v1/compliance/dossier/${encoded}?${qs}`,
      {},
      { timeoutMs: ComplianceApiClient.LONG_TIMEOUT_MS },
    );
  }

  getRisk(params: GetDossierParams): Promise<RiskAssessmentResult> {
    const search = new URLSearchParams();
    search.set('documentType', params.documentType);
    if (params.forceRefresh) search.set('forceRefresh', 'true');
    if (params.providerSlug) search.set('providerSlug', params.providerSlug);
    const qs = search.toString();
    const encoded = encodeURIComponent(params.document);
    return this.request<RiskAssessmentResult>(
      `/v1/compliance/dossier/${encoded}/risk?${qs}`,
      {},
      { timeoutMs: ComplianceApiClient.LONG_TIMEOUT_MS },
    );
  }
}

export const complianceApiClient = new ComplianceApiClient();
