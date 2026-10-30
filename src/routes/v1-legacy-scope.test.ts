import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => vi.fn());

vi.mock('../services/partner.service.js', async () => {
  const actual = await vi.importActual<typeof import('../services/partner.service.js')>(
    '../services/partner.service.js',
  );
  return {
    ...actual,
    authenticatePartnerBearer: auth,
    checkPartnerRateLimit: () => ({ ok: true, retryAfterSec: 0 }),
    logPartnerRequest: vi.fn(),
  };
});

import { registerV1Routes } from './v1.routes.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerV1Routes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe('legacy /v1 scope gate', () => {
  it('keeps a scoped token off the existing cotista list', async () => {
    auth.mockResolvedValue({
      id: 'p1',
      name: 'Ipe Core',
      rateLimitRpm: 120,
      scopes: ['fim.shareholders.read', 'fim.subscriptions.write'],
    });
    const res = await fetch(`${baseUrl}/v1/cotistas`, {
      headers: { Authorization: 'Bearer opc_test' },
    });
    expect(res.status).toBe(403);
  });

  it('keeps an unscoped token off the FIM routes', async () => {
    auth.mockResolvedValue({
      id: 'p2',
      name: 'Index portal',
      rateLimitRpm: 120,
      scopes: [],
    });
    const res = await fetch(`${baseUrl}/v1/fim/subscriptions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer opc_test', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Maria',
        document: '12345678901',
        amountBrl: 100,
        externalId: 'bank-1',
      }),
    });
    expect(res.status).toBe(403);
  });
});
