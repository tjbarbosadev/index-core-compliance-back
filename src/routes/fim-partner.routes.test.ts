import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  subscribeFim: vi.fn(),
  redeemFim: vi.fn(),
  getFimShareholder: vi.fn(),
  getFimShareholderYields: vi.fn(),
}));

vi.mock('../services/fim-subscription.service.js', async () => {
  const actual = await vi.importActual<typeof import('../services/fim-subscription.service.js')>(
    '../services/fim-subscription.service.js',
  );
  return {
    ...actual,
    subscribeFim: mocks.subscribeFim,
    getFimShareholder: mocks.getFimShareholder,
    getFimShareholderYields: mocks.getFimShareholderYields,
  };
});

vi.mock('../services/fim-redemption.service.js', async () => {
  const actual = await vi.importActual<typeof import('../services/fim-redemption.service.js')>(
    '../services/fim-redemption.service.js',
  );
  return {
    ...actual,
    redeemFim: mocks.redeemFim,
  };
});

import { registerFimPartnerRoutes } from './fim-partner.routes.js';
import type { AuthenticatedPartner } from '../services/partner.service.js';

let server: Server;
let baseUrl: string;

function partner(scopes: string[]): AuthenticatedPartner {
  return { id: 'partner-1', name: 'Ipe Core', rateLimitRpm: 120, scopes };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerFimPartnerRoutes(app, {
    requirePartner(req, res, next) {
      const raw = req.header('x-test-partner');
      if (!raw) {
        res.status(401).json({ error: 'Token inválido ou ausente' });
        return;
      }
      (req as { partner?: AuthenticatedPartner }).partner = JSON.parse(raw) as AuthenticatedPartner;
      next();
    },
    logPartnerAccess(_req, _res, next) {
      next();
    },
  });
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
});

function call(path: string, init: RequestInit, scopes?: string[]) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(scopes ? { 'x-test-partner': JSON.stringify(partner(scopes)) } : {}),
      ...(init.headers ?? {}),
    },
  });
}

describe('FIM partner routes', () => {
  it('rejects a missing token', async () => {
    const res = await call('/v1/fim/shareholders/12345678901', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('rejects a token without the FIM read scope', async () => {
    const res = await call('/v1/fim/shareholders/12345678901', { method: 'GET' }, []);
    expect(res.status).toBe(403);
  });

  it('rejects a write token on the read route', async () => {
    const res = await call('/v1/fim/shareholders/12345678901', { method: 'GET' }, [
      'fim.subscriptions.write',
    ]);
    expect(res.status).toBe(403);
  });

  it('returns the position for a read token', async () => {
    mocks.getFimShareholder.mockResolvedValue({ document: '12345678901', balance: 100 });
    const res = await call('/v1/fim/shareholders/12345678901', { method: 'GET' }, [
      'fim.shareholders.read',
    ]);
    expect(res.status).toBe(200);
    expect(mocks.getFimShareholder).toHaveBeenCalledWith('12345678901');
  });

  it('passes days and from/to through to the yield query', async () => {
    mocks.getFimShareholderYields.mockResolvedValue({ items: [] });
    const days = await call('/v1/fim/shareholders/12345678901/yields?days=30', { method: 'GET' }, [
      'fim.shareholders.read',
    ]);
    expect(days.status).toBe(200);
    expect(mocks.getFimShareholderYields).toHaveBeenCalledWith('12345678901', {
      days: '30',
      from: undefined,
      to: undefined,
    });
    await call(
      '/v1/fim/shareholders/12345678901/yields?from=2026-06-01&to=2026-06-30',
      { method: 'GET' },
      ['fim.shareholders.read'],
    );
    expect(mocks.getFimShareholderYields).toHaveBeenLastCalledWith('12345678901', {
      days: undefined,
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });

  it('creates a subscription only with the write scope', async () => {
    const denied = await call(
      '/v1/fim/subscriptions',
      { method: 'POST', body: JSON.stringify({ name: 'Maria' }) },
      ['fim.shareholders.read'],
    );
    expect(denied.status).toBe(403);
    mocks.subscribeFim.mockResolvedValue({ result: 'created', document: '12345678901' });
    const res = await call(
      '/v1/fim/subscriptions',
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Maria',
          document: '12345678901',
          amountBrl: 100,
          externalId: 'bank-1',
        }),
      },
      ['fim.subscriptions.write'],
    );
    expect(res.status).toBe(200);
    expect(mocks.subscribeFim).toHaveBeenCalled();
  });

  it('creates a redemption only with the redemptions write scope', async () => {
    const denied = await call(
      '/v1/fim/redemptions',
      {
        method: 'POST',
        body: JSON.stringify({
          document: '12345678901',
          amountBrl: 149.9,
          externalId: 'bank-redeem-1',
        }),
      },
      ['fim.subscriptions.write'],
    );
    expect(denied.status).toBe(403);
    mocks.redeemFim.mockResolvedValue({ result: 'pending', document: '12345678901' });
    const res = await call(
      '/v1/fim/redemptions',
      {
        method: 'POST',
        body: JSON.stringify({
          document: '12345678901',
          amountBrl: 149.9,
          externalId: 'bank-redeem-1',
        }),
      },
      ['fim.redemptions.write'],
    );
    expect(res.status).toBe(200);
    expect(mocks.redeemFim).toHaveBeenCalled();
  });
});
