import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock, execFileMock } = vi.hoisted(() => ({
  envMock: {
    megaVaultUrl: '',
    megaVaultApiKey: '',
    megaEmail: 'a@b.c',
    megaPassword: 'secret',
    megacmdContainer: undefined as string | undefined,
  },
  execFileMock: vi.fn(),
}));

vi.mock('../env.js', () => ({ env: envMock }));

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import { ensureMegaLogin, megaRm, parseMegaLsHandle, resetMegaLoginCache } from './cmd.js';

type ExecCb = (err: Error | null, result?: { stdout: string; stderr: string }) => void;

function resolveCb(optsOrCb: unknown, maybeCb: unknown | undefined): ExecCb {
  return (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as ExecCb;
}

function execOk(stdout = '', stderr = '') {
  return (_file: string, _args: string[], optsOrCb: unknown, maybeCb?: unknown) => {
    const cb = resolveCb(optsOrCb, maybeCb);
    Promise.resolve()
      .then(() => cb(null, { stdout, stderr }))
      .catch(() => undefined);
  };
}

function execFail(detail: string, code?: string) {
  return (_file: string, _args: string[], optsOrCb: unknown, maybeCb?: unknown) => {
    const cb = resolveCb(optsOrCb, maybeCb);
    const err = Object.assign(new Error(detail), {
      code,
      stderr: detail,
      stdout: '',
    });
    Promise.resolve()
      .then(() => cb(err))
      .catch(() => undefined);
  };
}

describe('parseMegaLsHandle', () => {
  it('extracts handle from listing line', () => {
    expect(parseMegaLsHandle('file.pdf  H:abc123  size', 'file.pdf')).toBe('H:abc123');
  });
});

describe('megaRm', () => {
  beforeEach(() => {
    resetMegaLoginCache();
    envMock.megacmdContainer = undefined;
    envMock.megaEmail = 'a@b.c';
    envMock.megaPassword = 'secret';
    execFileMock.mockReset();
  });

  it('ignores confirmed node-not-found errors', async () => {
    execFileMock
      .mockImplementationOnce(execOk('email@x'))
      .mockImplementationOnce(execFail("Couldn't find node H:gone"));

    await expect(megaRm('H:gone')).resolves.toBeUndefined();
  });

  it('rethrows non-not-found Mega failures', async () => {
    execFileMock
      .mockImplementationOnce(execOk('email@x'))
      .mockImplementationOnce(execFail('timeout talking to mega'));

    await expect(megaRm('H:x')).rejects.toMatchObject({
      name: 'MegaError',
      status: 502,
      message: expect.stringMatching(/timeout/i),
    });
  });

  it('maps missing MEGAcmd binary to 503', async () => {
    execFileMock
      .mockImplementationOnce(execOk('email@x'))
      .mockImplementationOnce(execFail('spawn mega-rm ENOENT', 'ENOENT'));

    await expect(megaRm('H:x')).rejects.toMatchObject({ status: 503 });
  });
});

describe('session cache', () => {
  beforeEach(() => {
    resetMegaLoginCache();
    execFileMock.mockReset();
  });

  it('clears login cache when a later command reports session lost', async () => {
    execFileMock.mockImplementationOnce(execOk('logged-in@x'));
    await ensureMegaLogin();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    await ensureMegaLogin();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    execFileMock.mockImplementationOnce(execFail('Not logged in. Please login.'));
    await expect(megaRm('H:x')).rejects.toMatchObject({ status: 502 });

    execFileMock.mockImplementationOnce(execOk('logged-in@x'));
    await ensureMegaLogin();
    expect(execFileMock.mock.calls.length).toBeGreaterThan(2);
  });
});
