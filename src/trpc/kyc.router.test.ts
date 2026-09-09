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

describe('kyc router RBAC', () => {
  it('forbids list without compliance.read', async () => {
    await expect(caller([]).kyc.list({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('forbids generate without compliance.write', async () => {
    await expect(
      caller(['compliance.read']).kyc.generate({
        document: '58426534000164',
        documentType: 'CNPJ',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
