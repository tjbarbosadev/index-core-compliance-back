import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock, cmdMock } = vi.hoisted(() => ({
  envMock: {
    megaVaultUrl: '',
    megaVaultApiKey: '',
    megaEmail: '',
    megaPassword: '',
    megacmdContainer: undefined as string | undefined,
  },
  cmdMock: {
    uploadBufferWithMegacmd: vi.fn(),
    downloadBufferWithMegacmd: vi.fn(),
    megaRm: vi.fn(),
  },
}));

vi.mock('../env.js', () => ({ env: envMock }));

vi.mock('./cmd.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cmd.js')>();
  return { ...actual, ...cmdMock };
});

import {
  deletePartnerFile,
  downloadPartnerFile,
  MegaError,
  megaConfigured,
  uploadPartnerFile,
} from './client.js';
import { partnerDocsFolder, sanitizeFileName } from './folder.js';

const input = {
  buffer: Buffer.from('pdf-bytes'),
  fileName: '11111111-1111-1111-1111-111111111111__rg.pdf',
  mimeType: 'application/pdf',
  partnerId: 'partner-1',
  document: '12345678901',
};

function resetEnv() {
  envMock.megaVaultUrl = '';
  envMock.megaVaultApiKey = '';
  envMock.megaEmail = '';
  envMock.megaPassword = '';
  envMock.megacmdContainer = undefined;
}

describe('mega folder helpers', () => {
  it('builds partner-docs folder with digits only', () => {
    expect(partnerDocsFolder('p1', '123.456.789-01')).toBe('partner-docs/p1/12345678901');
  });

  it('rejects unsafe partner ids', () => {
    expect(() => partnerDocsFolder('../x', '123')).toThrow();
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('Relatório Final (1).pdf')).toBe('Relatorio_Final_1_.pdf');
  });
});

describe('mega client', () => {
  beforeEach(() => {
    resetEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('unconfigured', () => {
    it('reports not configured and throws 503 on every operation', async () => {
      expect(megaConfigured()).toBe(false);
      await expect(uploadPartnerFile(input)).rejects.toMatchObject({
        name: 'MegaError',
        status: 503,
      });
      await expect(downloadPartnerFile('H:abc')).rejects.toMatchObject({ status: 503 });
      await expect(deletePartnerFile('H:abc')).rejects.toMatchObject({ status: 503 });
      await expect(uploadPartnerFile(input)).rejects.toBeInstanceOf(MegaError);
    });
  });

  describe('vault mode', () => {
    beforeEach(() => {
      envMock.megaVaultUrl = 'https://vault.test';
      envMock.megaVaultApiKey = 'key-123';
    });

    it('uploads with system=opcore and partner-docs folder', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({ id: 'H:vault1', path: '/opcore/x', name: input.fileName }),
            { status: 200 },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);

      expect(megaConfigured()).toBe(true);
      const result = await uploadPartnerFile(input);

      expect(result).toEqual({ id: 'H:vault1', path: '/opcore/x', name: input.fileName });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://vault.test/v1/files');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('key-123');
      const form = init.body as FormData;
      expect(form.get('system')).toBe('opcore');
      expect(form.get('folder')).toBe('partner-docs/partner-1/12345678901');
      expect((form.get('file') as File).name).toBe(input.fileName);
      expect(cmdMock.uploadBufferWithMegacmd).not.toHaveBeenCalled();
    });

    it('maps non-2xx vault responses to 502', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 })),
      );
      await expect(uploadPartnerFile(input)).rejects.toMatchObject({
        name: 'MegaError',
        status: 502,
        message: 'boom',
      });
    });

    it('maps network failures to 502', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );
      await expect(uploadPartnerFile(input)).rejects.toMatchObject({ status: 502 });
      await expect(deletePartnerFile('H:abc')).rejects.toMatchObject({ status: 502 });
    });

    it('maps invalid vault payload to 502', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
      );
      await expect(uploadPartnerFile(input)).rejects.toMatchObject({ status: 502 });
    });

    it('deletes via vault and tolerates 404', async () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(deletePartnerFile('H:a/b')).resolves.toBeUndefined();
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://vault.test/v1/files/H%3Aa%2Fb');
      expect(init.method).toBe('DELETE');
    });

    it('download is 501 in vault-only mode', async () => {
      await expect(downloadPartnerFile('H:abc')).rejects.toMatchObject({ status: 501 });
    });
  });

  describe('account (MEGAcmd) mode', () => {
    beforeEach(() => {
      envMock.megaEmail = 'a@b.c';
      envMock.megaPassword = 'secret';
      envMock.megaVaultUrl = 'https://vault.test';
      envMock.megaVaultApiKey = 'key-123';
    });

    it('prefers MEGAcmd over vault and builds /opcore path', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      cmdMock.uploadBufferWithMegacmd.mockResolvedValue({ id: 'H:cmd1', name: input.fileName });

      const result = await uploadPartnerFile(input);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(cmdMock.uploadBufferWithMegacmd).toHaveBeenCalledWith({
        buffer: input.buffer,
        fileName: input.fileName,
        destDir: '/opcore/partner-docs/partner-1/12345678901',
      });
      expect(result).toEqual({
        id: 'H:cmd1',
        path: `/opcore/partner-docs/partner-1/12345678901/${input.fileName}`,
        name: input.fileName,
      });
    });

    it('wraps unexpected MEGAcmd failures as 502', async () => {
      cmdMock.uploadBufferWithMegacmd.mockRejectedValue(new Error('docker cp failed'));
      await expect(uploadPartnerFile(input)).rejects.toMatchObject({
        name: 'MegaError',
        status: 502,
      });
    });

    it('preserves MegaError status from MEGAcmd', async () => {
      cmdMock.uploadBufferWithMegacmd.mockRejectedValue(new MegaError(503, 'sem MEGAcmd'));
      await expect(uploadPartnerFile(input)).rejects.toMatchObject({ status: 503 });
    });

    it('downloads and deletes via MEGAcmd', async () => {
      cmdMock.downloadBufferWithMegacmd.mockResolvedValue(Buffer.from('x'));
      cmdMock.megaRm.mockResolvedValue(undefined);
      await expect(downloadPartnerFile('H:cmd1')).resolves.toEqual(Buffer.from('x'));
      await expect(deletePartnerFile('H:cmd1')).resolves.toBeUndefined();
      expect(cmdMock.downloadBufferWithMegacmd).toHaveBeenCalledWith('H:cmd1');
      expect(cmdMock.megaRm).toHaveBeenCalledWith('H:cmd1');
    });
  });
});
