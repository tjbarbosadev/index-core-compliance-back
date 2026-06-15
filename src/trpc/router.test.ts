import { describe, it, expect } from 'vitest';
import { appRouter } from './router.js';

describe('health router', () => {
  it('returns ok status', async () => {
    const caller = appRouter.createCaller({
      req: { cookies: {}, ip: '127.0.0.1' } as never,
      res: { clearCookie: () => undefined } as never,
      prisma: {} as never,
      user: null,
      permissions: [],
      sessionId: undefined,
      ip: '127.0.0.1',
    });
    const result = await caller.health.check();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeTruthy();
  });
});
