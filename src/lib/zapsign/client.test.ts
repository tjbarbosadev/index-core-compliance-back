import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  nodeEnv: 'production',
  zapsignApiToken: 'token-123',
  zapsignBaseUrl: 'https://sandbox.api.zapsign.com.br/api/v1',
  zapsignSandbox: true,
  zapsignSandboxSignerEmail: 'qa@example.com' as string | undefined,
}));
vi.mock('../env.js', () => ({ env }));

import {
  ZapSignConfigError,
  createZapSignDocument,
  downloadZapSignFile,
  resolveSignerEmail,
} from './client.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  Object.assign(env, {
    nodeEnv: 'production',
    zapsignApiToken: 'token-123',
    zapsignSandbox: true,
    zapsignSandboxSignerEmail: 'qa@example.com',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveSignerEmail', () => {
  it('redirects every signer to the sandbox mailbox', () => {
    expect(resolveSignerEmail('real@cliente.com')).toBe('qa@example.com');
  });

  it('keeps the real email outside sandbox', () => {
    env.zapsignSandbox = false;
    expect(resolveSignerEmail('real@cliente.com')).toBe('real@cliente.com');
  });

  it('refuses sandbox mode without a test mailbox', () => {
    env.zapsignSandboxSignerEmail = undefined;
    expect(() => resolveSignerEmail('real@cliente.com')).toThrow(ZapSignConfigError);
  });
});

describe('createZapSignDocument', () => {
  it('posts the PDF with signature anchors and redirected signers', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ token: 'doc-1', signers: [] }), { status: 200 }),
    );
    const doc = await createZapSignDocument({
      name: 'Ficha',
      pdf: Buffer.from('%PDF-1.4'),
      externalId: 'proc:doc',
      signers: [
        { name: 'Rep', email: 'rep@cliente.com', signaturePlacement: '{{assinaturaCliente}}' },
      ],
    });

    expect(doc.token).toBe('doc-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://sandbox.api.zapsign.com.br/api/v1/docs/');
    expect(init.headers.Authorization).toBe('Bearer token-123');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      name: 'Ficha',
      base64_pdf: Buffer.from('%PDF-1.4').toString('base64'),
      external_id: 'proc:doc',
      brand_name: 'IndexCore',
    });
    expect(body).not.toHaveProperty('sandbox');
    expect(body.signers).toEqual([
      expect.objectContaining({
        name: 'Rep',
        email: 'qa@example.com',
        signature_placement: '{{assinaturaCliente}}',
        lock_email: true,
      }),
    ]);
  });

  it('surfaces the ZapSign error detail', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Token inválido' }), { status: 401 }),
    );
    await expect(
      createZapSignDocument({
        name: 'x',
        pdf: Buffer.from('x'),
        signers: [{ name: 'a', email: 'a@b.com' }],
      }),
    ).rejects.toThrow('ZapSign 401: Token inválido');
  });

  it('fails fast without a token', async () => {
    env.zapsignApiToken = '';
    await expect(
      createZapSignDocument({
        name: 'x',
        pdf: Buffer.from('x'),
        signers: [{ name: 'a', email: 'a@b.com' }],
      }),
    ).rejects.toThrow(ZapSignConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('downloadZapSignFile', () => {
  it('rejects plain http in production', async () => {
    await expect(downloadZapSignFile('http://evil.example/a.pdf')).rejects.toThrow(
      'URL de arquivo ZapSign inválida',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloads https files', async () => {
    fetchMock.mockResolvedValue(new Response('%PDF', { status: 200 }));
    const buf = await downloadZapSignFile('https://zapsign.s3.amazonaws.com/a.pdf');
    expect(buf.toString()).toBe('%PDF');
  });
});
