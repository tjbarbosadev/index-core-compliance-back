import { describe, expect, it, vi } from 'vitest';
import { NextcorefimApiClient, NextcorefimApiError } from './client.js';

vi.mock('../env.js', () => ({
  env: {
    nextcorefimApiUrl: 'http://localhost:3002',
    nextcorefimApiServiceKey: 'test-key',
  },
}));

describe('NextcorefimApiClient', () => {
  it('wraps network failures as 503 with PT message', async () => {
    const client = new NextcorefimApiClient(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(client.listDocuments('app-1')).rejects.toMatchObject({
      name: 'NextcorefimApiError',
      status: 503,
    });

    try {
      await client.listDocuments('app-1');
    } catch (err) {
      expect(err).toBeInstanceOf(NextcorefimApiError);
      expect((err as NextcorefimApiError).message).toMatch(/indisponível/i);
    }
  });
});
