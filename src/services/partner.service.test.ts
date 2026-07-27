import { describe, expect, it, beforeEach } from 'vitest';
import {
  hashPartnerToken,
  generatePartnerToken,
  checkPartnerRateLimit,
  _clearRateBucketsForTests,
} from './partner.service.js';

describe('partner.service', () => {
  beforeEach(() => {
    _clearRateBucketsForTests();
  });

  it('hashes tokens deterministically', () => {
    const a = hashPartnerToken('opc_abc');
    const b = hashPartnerToken('opc_abc');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('generates opc_ prefixed tokens', () => {
    expect(generatePartnerToken().startsWith('opc_')).toBe(true);
  });

  it('enforces rate limit per partner', () => {
    const id = 'partner-1';
    for (let i = 0; i < 3; i++) {
      expect(checkPartnerRateLimit(id, 3).ok).toBe(true);
    }
    const blocked = checkPartnerRateLimit(id, 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});
