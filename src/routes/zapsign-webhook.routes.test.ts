import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { applyZapSignDocumentState, env } = vi.hoisted(() => ({
  applyZapSignDocumentState: vi.fn(),
  env: { zapsignWebhookSecret: 's3cret' },
}));

vi.mock('../lib/env.js', () => ({ env }));
vi.mock('../services/cedente-onboarding.service.js', () => ({ applyZapSignDocumentState }));

import { isValidWebhookSecret, registerZapSignWebhookRoutes } from './zapsign-webhook.routes.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerZapSignWebhookRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  env.zapsignWebhookSecret = 's3cret';
  applyZapSignDocumentState.mockResolvedValue({ handled: true, envelopeId: 'env-1' });
});

function post(body: unknown, query = '?secret=s3cret', headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/webhooks/zapsign${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('isValidWebhookSecret', () => {
  it('compares secrets in constant time and rejects missing values', () => {
    expect(isValidWebhookSecret('abc', 'abc')).toBe(true);
    expect(isValidWebhookSecret('abd', 'abc')).toBe(false);
    expect(isValidWebhookSecret('ab', 'abc')).toBe(false);
    expect(isValidWebhookSecret(undefined, 'abc')).toBe(false);
    expect(isValidWebhookSecret('abc', '')).toBe(false);
  });
});

describe('POST /webhooks/zapsign', () => {
  it('returns 503 when no secret is configured', async () => {
    env.zapsignWebhookSecret = '';
    expect((await post({ event_type: 'doc_signed' })).status).toBe(503);
    expect(applyZapSignDocumentState).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    expect((await post({ event_type: 'doc_signed' }, '?secret=nope')).status).toBe(401);
    expect((await post({ event_type: 'doc_signed' }, '')).status).toBe(401);
    expect(applyZapSignDocumentState).not.toHaveBeenCalled();
  });

  it('accepts the secret in the x-webhook-secret header', async () => {
    const res = await post({ event_type: 'doc_signed', token: 't' }, '', {
      'x-webhook-secret': 's3cret',
    });
    expect(res.status).toBe(200);
  });

  it('ignores events other than signed/refused', async () => {
    const res = await post({ event_type: 'doc_viewed', token: 't' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ignored: true });
    expect(applyZapSignDocumentState).not.toHaveBeenCalled();
  });

  it('applies a signed document', async () => {
    const res = await post({
      event_type: 'doc_signed',
      token: 'tok',
      status: 'signed',
      signed_file: 'https://s3/a.pdf',
    });
    expect(res.status).toBe(200);
    expect(applyZapSignDocumentState).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', status: 'signed', signed_file: 'https://s3/a.pdf' }),
    );
  });

  it('forces the refused status on doc_refused', async () => {
    await post({ event_type: 'doc_refused', token: 'tok', status: 'pending' });
    expect(applyZapSignDocumentState).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'refused' }),
    );
  });

  it('returns 500 so ZapSign retries when processing fails', async () => {
    applyZapSignDocumentState.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post({ event_type: 'doc_signed', token: 'tok' })).status).toBe(500);
  });
});
