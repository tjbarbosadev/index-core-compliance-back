import { describe, expect, it } from 'vitest';
import { appRouter } from './router.js';

function caller(permissions: string[], isAdmin = false) {
  return appRouter.createCaller({
    req: { cookies: {}, ip: '127.0.0.1' } as never,
    res: { clearCookie: () => undefined } as never,
    prisma: {} as never,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      email: 't@test.local',
      name: 'Test',
      isAdmin,
      status: 'active',
    } as never,
    permissions,
    sessionId: 's',
    partner: null,
    serviceAuth: false,
    ip: '127.0.0.1',
  });
}

describe('billing router RBAC', () => {
  it('forbids overview without admin', async () => {
    await expect(caller(['compliance.read']).billing.overview()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('forbids invoice creation without admin', async () => {
    await expect(
      caller(['documents.write']).billing.invoices.create({
        vendor: 'bigdatacorp',
        referenceMonth: '2026-09',
        amount: 10,
        dueDate: '2026-10-10',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('validates invoice input for admins', async () => {
    await expect(
      caller([], true).billing.invoices.create({
        vendor: 'bigdatacorp',
        referenceMonth: '09/2026',
        amount: -1,
        dueDate: '10/10/2026',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
