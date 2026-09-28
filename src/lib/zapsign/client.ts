import { env } from '../env.js';

export type ZapSignSignerInput = {
  name: string;
  email: string;
  /** Anchor text in the PDF where this signer's signature goes. */
  signaturePlacement?: string;
  externalId?: string;
};

export type ZapSignSigner = {
  token: string;
  sign_url: string;
  status: 'new' | 'link-opened' | 'signed' | 'refused' | string;
  name: string;
  email: string;
  external_id?: string | null;
  signed_at?: string | null;
};

export type ZapSignDocument = {
  token: string;
  name: string;
  status: 'pending' | 'signed' | 'refused' | 'cancelled' | string;
  original_file?: string | null;
  signed_file?: string | null;
  external_id?: string | null;
  sandbox?: boolean;
  signers: ZapSignSigner[];
};

export class ZapSignConfigError extends Error {}

function assertConfigured() {
  if (!env.zapsignApiToken) {
    throw new ZapSignConfigError('ZapSign não configurado (ZAPSIGN_API_TOKEN ausente)');
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  assertConfigured();
  const res = await fetch(`${env.zapsignBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.zapsignApiToken}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : typeof body === 'string'
          ? body.slice(0, 200)
          : JSON.stringify(body).slice(0, 200);
    throw new Error(`ZapSign ${res.status}: ${detail}`);
  }
  return body as T;
}

/**
 * In sandbox mode every signer is redirected to the configured test mailbox,
 * so a test onboarding never emails real representatives.
 */
export function resolveSignerEmail(email: string): string {
  if (!env.zapsignSandbox) return email;
  if (!env.zapsignSandboxSignerEmail) {
    throw new ZapSignConfigError(
      'ZapSign em sandbox exige ZAPSIGN_SANDBOX_SIGNER_EMAIL (e-mail de teste dos signatários)',
    );
  }
  return env.zapsignSandboxSignerEmail;
}

export async function createZapSignDocument(input: {
  name: string;
  pdf: Buffer;
  signers: ZapSignSignerInput[];
  externalId?: string;
}): Promise<ZapSignDocument> {
  if (input.signers.length === 0) throw new Error('Documento sem signatários');
  return request<ZapSignDocument>('/docs/', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      base64_pdf: input.pdf.toString('base64'),
      external_id: input.externalId,
      lang: 'pt-br',
      disable_signer_emails: false,
      signature_order_active: false,
      brand_name: 'IndexCore',
      signers: input.signers.map((s) => ({
        name: s.name,
        email: resolveSignerEmail(s.email),
        external_id: s.externalId,
        auth_mode: 'assinaturaTela',
        send_automatic_email: true,
        send_automatic_whatsapp: false,
        lock_email: true,
        signature_placement: s.signaturePlacement,
      })),
    }),
  });
}

export async function getZapSignDocument(token: string): Promise<ZapSignDocument> {
  return request<ZapSignDocument>(`/docs/${encodeURIComponent(token)}/`);
}

/** Signed files are short-lived S3 URLs returned by ZapSign. */
export async function downloadZapSignFile(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  const allowed =
    parsed.protocol === 'https:' || (env.nodeEnv !== 'production' && parsed.protocol === 'http:');
  if (!allowed) throw new Error('URL de arquivo ZapSign inválida');
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Falha ao baixar arquivo assinado (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
