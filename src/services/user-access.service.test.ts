import { describe, expect, it } from 'vitest';
import { deriveTabAccess } from './user-access.service.js';

describe('user-access.service', () => {
  it('derives read vs write from permission keys', () => {
    const tabs = deriveTabAccess(['fundos.read', 'cotistas.read', 'cotistas.write']);
    expect(tabs.fundos).toBe('read');
    expect(tabs.cotistas).toBe('write');
    expect(tabs.dashboard).toBeNull();
  });
});
