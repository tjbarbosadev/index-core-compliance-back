import { describe, it, expect } from 'vitest';
import { hasPermissionInList } from './permission.service.js';

describe('permission.service', () => {
  it('admin bypasses permission check', () => {
    expect(hasPermissionInList([], 'onboarding.read', true)).toBe(true);
  });

  it('returns true when permission is granted', () => {
    expect(hasPermissionInList(['cotistas.read'], 'cotistas.read', false)).toBe(true);
  });

  it('returns false when permission is missing', () => {
    expect(hasPermissionInList(['cotistas.read'], 'onboarding.read', false)).toBe(false);
  });
});
