import { env } from '../env.js';

type FetchFn = typeof fetch;

export class NextcorefimApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'NextcorefimApiError';
  }
}

export type FimDocumentFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type FimDocumentSlot = {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  files: FimDocumentFile[];
};

export type FimDocumentsChecklist = {
  id: string;
  type: 'PF' | 'PJ';
  complete: boolean;
  slots: FimDocumentSlot[];
};

export type EnsureApplicationResult = {
  id: string;
  type: 'PF' | 'PJ';
  taxId: string;
  created: boolean;
};

export type EnsureApplicationInput = {
  type: 'PF' | 'PJ';
  taxId: string;
  email?: string;
  legalName: string;
  administrators?: Array<{ name: string; cpf?: string }>;
};

function parseErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: unknown }).error;
    if (typeof err === 'string' && err.trim()) return err;
  }
  return fallback;
}

export class NextcorefimApiClient {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  private baseUrl(): string {
    return env.nextcorefimApiUrl.replace(/\/$/, '');
  }

  private apiKey(): string {
    const key = env.nextcorefimApiServiceKey;
    if (!key) {
      throw new NextcorefimApiError('NEXTCOREFIM_API_SERVICE_KEY não configurada', 500);
    }
    return key;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      'X-API-Key': this.apiKey(),
      ...extra,
    };
  }

  async ensureApplication(input: EnsureApplicationInput): Promise<EnsureApplicationResult> {
    const response = await this.fetchFn(`${this.baseUrl()}/internal/applications/ensure`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(input),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new NextcorefimApiError(
        parseErrorMessage(body, 'Falha ao vincular cadastro FIM'),
        response.status,
        body,
      );
    }

    return body as EnsureApplicationResult;
  }

  async listDocuments(applicationId: string): Promise<FimDocumentsChecklist> {
    const response = await this.fetchFn(
      `${this.baseUrl()}/internal/applications/${encodeURIComponent(applicationId)}/documents`,
      {
        method: 'GET',
        headers: this.headers(),
      },
    );

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new NextcorefimApiError(
        parseErrorMessage(body, 'Falha ao listar documentos FIM'),
        response.status,
        body,
      );
    }

    return body as FimDocumentsChecklist;
  }

  /**
   * Proxies a raw multipart body (slot + file) to nextcorefim.
   * Caller must pass the original Content-Type (with boundary).
   */
  async uploadDocument(
    applicationId: string,
    contentType: string,
    body: Buffer,
  ): Promise<FimDocumentsChecklist> {
    const response = await this.fetchFn(
      `${this.baseUrl()}/internal/applications/${encodeURIComponent(applicationId)}/documents`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': contentType }),
        body,
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new NextcorefimApiError(
        parseErrorMessage(payload, 'Falha ao enviar documento ao Mega'),
        response.status,
        payload,
      );
    }

    return payload as FimDocumentsChecklist;
  }

  async deleteDocument(applicationId: string, documentId: string): Promise<FimDocumentsChecklist> {
    const response = await this.fetchFn(
      `${this.baseUrl()}/internal/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}`,
      {
        method: 'DELETE',
        headers: this.headers(),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new NextcorefimApiError(
        parseErrorMessage(payload, 'Falha ao remover documento do Mega'),
        response.status,
        payload,
      );
    }

    return payload as FimDocumentsChecklist;
  }

  /**
   * Fetches document bytes from nextcorefim (Mega). Caller streams the Response body.
   */
  async downloadDocument(
    applicationId: string,
    documentId: string,
    disposition: 'inline' | 'attachment' = 'inline',
  ): Promise<Response> {
    const qs = new URLSearchParams({ disposition });
    const response = await this.fetchFn(
      `${this.baseUrl()}/internal/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}?${qs}`,
      {
        method: 'GET',
        headers: this.headers(),
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new NextcorefimApiError(
        parseErrorMessage(payload, 'Falha ao baixar documento do Mega'),
        response.status,
        payload,
      );
    }

    return response;
  }
}

export const nextcorefimClient = new NextcorefimApiClient();
