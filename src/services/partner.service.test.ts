import { describe, expect, it, beforeEach } from 'vitest';
import {
  hashPartnerToken,
  generatePartnerToken,
  checkPartnerRateLimit,
  normalizePartnerScopes,
  FIM_PARTNER_SCOPES,
  FIM_SCOPE_DOCUMENTS_WRITE,
  FIM_SCOPE_DOCUMENTS_READ,
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

  describe('normalizePartnerScopes', () => {
    it('exposes document scopes in FIM_PARTNER_SCOPES', () => {
      expect(FIM_SCOPE_DOCUMENTS_WRITE).toBe('fim.documents.write');
      expect(FIM_SCOPE_DOCUMENTS_READ).toBe('fim.documents.read');
      expect(FIM_PARTNER_SCOPES).toContain('fim.documents.write');
      expect(FIM_PARTNER_SCOPES).toContain('fim.documents.read');
    });

    it('accepts document scopes', () => {
      expect(normalizePartnerScopes(['fim.documents.write'])).toEqual(['fim.documents.write']);
      expect(normalizePartnerScopes(['fim.documents.read', ' fim.documents.write '])).toEqual([
        'fim.documents.read',
        'fim.documents.write',
      ]);
    });

    it('rejects unknown scopes', () => {
      expect(() => normalizePartnerScopes(['fim.documents.delete'])).toThrow('Escopo desconhecido');
      expect(() => normalizePartnerScopes(['fim.documents.write', 'bogus'])).toThrow(
        'Escopo desconhecido',
      );
    });
  });
});
