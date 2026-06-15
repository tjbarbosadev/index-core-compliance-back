import { describe, it, expect } from 'vitest';
import { mapAuditLog } from './audit.service.js';

describe('audit.service', () => {
  it('mapAuditLog normalizes database row', () => {
    const mapped = mapAuditLog({
      id: 'log-1',
      userId: 'user-1',
      action: 'onboarding.approve',
      entityType: 'onboarding_process',
      entityId: 'proc-1',
      details: { reason: 'ok' },
      ipAddress: '127.0.0.1',
      result: 'sucesso',
      createdAt: new Date('2025-06-15T12:00:00.000Z'),
      user: { name: 'Compliance User' },
    } as never);

    expect(mapped).toMatchObject({
      id: 'log-1',
      userId: 'user-1',
      userName: 'Compliance User',
      action: 'onboarding.approve',
      entityType: 'onboarding_process',
      entityId: 'proc-1',
      result: 'sucesso',
    });
    expect(mapped.createdAt).toBe('2025-06-15T12:00:00.000Z');
  });
});
