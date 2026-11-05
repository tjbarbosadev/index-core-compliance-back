import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  resolveOpenWaSessionId: vi.fn(),
  env: {
    openWaBaseUrl: 'http://crm_openwa:2785' as string | undefined,
    openWaApiKey: 'test-key' as string | undefined,
    openWaSessionId: undefined as string | undefined,
    openWaSessionName: 'opcore-alerts' as string | undefined,
  },
}));

vi.mock('../db/index.js', () => ({
  prisma: {
    whatsappSession: {
      findFirst: mocks.findFirst,
    },
  },
}));

vi.mock('../lib/env.js', () => ({
  env: mocks.env,
}));

vi.mock('./whatsapp.service.js', async () => {
  const actual =
    await vi.importActual<typeof import('./whatsapp.service.js')>('./whatsapp.service.js');
  return {
    ...actual,
    resolveOpenWaSessionId: mocks.resolveOpenWaSessionId,
  };
});

import { resolveSenderOpenWaSessionId } from './whatsapp-session.service.js';

describe('resolveSenderOpenWaSessionId', () => {
  beforeEach(() => {
    mocks.findFirst.mockReset();
    mocks.resolveOpenWaSessionId.mockReset();
    mocks.env.openWaBaseUrl = 'http://crm_openwa:2785';
    mocks.env.openWaApiKey = 'test-key';
    mocks.env.openWaSessionId = undefined;
    mocks.env.openWaSessionName = 'opcore-alerts';
  });

  it('usa OPENWA_SESSION_ID quando setado', async () => {
    mocks.env.openWaSessionId = 'explicit-session-id';

    await expect(resolveSenderOpenWaSessionId()).resolves.toBe('explicit-session-id');
    expect(mocks.resolveOpenWaSessionId).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('cai em OPENWA_SESSION_NAME quando não há SESSION_ID', async () => {
    mocks.resolveOpenWaSessionId.mockResolvedValue('named-session-id');

    await expect(resolveSenderOpenWaSessionId()).resolves.toBe('named-session-id');
    expect(mocks.resolveOpenWaSessionId).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://crm_openwa:2785',
        apiKey: 'test-key',
        sessionName: 'opcore-alerts',
      }),
    );
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('cai na primeira sessão opt-in ready se o nome não resolver', async () => {
    mocks.resolveOpenWaSessionId.mockResolvedValue(null);
    mocks.findFirst.mockResolvedValue({ openwaSessionId: 'ready-optin-id' });

    await expect(resolveSenderOpenWaSessionId()).resolves.toBe('ready-optin-id');
    expect(mocks.findFirst).toHaveBeenCalled();
  });
});
