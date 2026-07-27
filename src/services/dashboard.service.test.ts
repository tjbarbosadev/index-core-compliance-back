import { describe, it, expect } from 'vitest';
import { mapActivity } from './dashboard.service.js';

describe('dashboard.service', () => {
  it('mapActivity normalizes audit log into Activity', () => {
    const mapped = mapActivity({
      id: 'log-1',
      userId: 'user-1',
      action: 'funds.create',
      entityType: 'fund',
      entityId: 'fund-1',
      details: { name: 'FIDC Alpha' },
      ipAddress: '127.0.0.1',
      result: 'sucesso',
      createdAt: new Date('2025-06-15T12:00:00.000Z'),
      user: { name: 'Compliance User' },
    } as never);

    expect(mapped).toEqual({
      id: 'log-1',
      action: 'funds.create',
      entityType: 'fund',
      entityId: 'fund-1',
      entityName: 'FIDC Alpha',
      userName: 'Compliance User',
      createdAt: '2025-06-15T12:00:00.000Z',
    });
  });

  it('mapActivity falls back to Sistema when user is missing', () => {
    const mapped = mapActivity({
      id: 'log-2',
      userId: null,
      action: 'scheduler.run',
      entityType: null,
      entityId: null,
      details: {},
      ipAddress: null,
      result: 'sucesso',
      createdAt: new Date('2025-06-16T08:00:00.000Z'),
      user: null,
    } as never);

    expect(mapped.userName).toBe('Sistema');
    expect(mapped.entityType).toBe('');
    expect(mapped.entityId).toBe('');
    expect(mapped.entityName).toBeUndefined();
  });
});
