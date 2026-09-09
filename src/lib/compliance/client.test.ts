import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env.js', () => ({
  env: {
    complianceApiUrl: 'https://api.compliance.opcore.com.br',
    complianceApiServiceKey: 'test-key',
    complianceApiSub: 'admin',
    complianceApiService: 'admin',
  },
}));

import { ComplianceApiClient } from './client.js';

describe('ComplianceApiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    new ComplianceApiClient().resetTokenCache();
  });

  it('caches JWT until near expiry', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/token')) {
        return new Response(JSON.stringify({ token: 'jwt-1', expiresIn: '1h' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/compliance/dossier/')) {
        return new Response(
          JSON.stringify({
            meta: { document: '58426534000164', documentType: 'CNPJ' },
            risk: { level: 'baixo', score: 10 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const client = new ComplianceApiClient(global.fetch);
    await client.getDossier({ document: '58426534000164', documentType: 'CNPJ' });
    await client.getDossier({ document: '58426534000164', documentType: 'CNPJ' });

    const tokenCalls = calls.filter((url) => url.endsWith('/auth/token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('sends API key on token request', async () => {
    let apiKey: string | undefined;
    global.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/token')) {
        const headers = new Headers(init?.headers);
        apiKey = headers.get('X-API-Key') ?? undefined;
        return new Response(JSON.stringify({ token: 'jwt-2', expiresIn: '8h' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ meta: { document: '123' }, risk: { level: 'baixo' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new ComplianceApiClient(global.fetch);
    await client.getRisk({ document: '52998224725', documentType: 'CPF' });
    expect(apiKey).toBe('test-key');
  });

  it('throws ComplianceApiError when key is empty', async () => {
    const { env } = await import('../env.js');
    const prev = env.complianceApiServiceKey;
    (env as { complianceApiServiceKey: string }).complianceApiServiceKey = '';
    const client = new ComplianceApiClient();
    client.resetTokenCache();
    await expect(client.getToken()).rejects.toMatchObject({
      name: 'ComplianceApiError',
      status: 500,
    });
    (env as { complianceApiServiceKey: string }).complianceApiServiceKey = prev;
  });
});
