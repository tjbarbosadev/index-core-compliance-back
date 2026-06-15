import { describe, it, expect } from 'vitest';
import { KYC_DOCUMENT_TYPES } from '../lib/errors.js';

describe('document KYC types', () => {
  it('includes rg and minuta_cessao', () => {
    expect(KYC_DOCUMENT_TYPES.has('rg')).toBe(true);
    expect(KYC_DOCUMENT_TYPES.has('minuta_cessao')).toBe(true);
  });

  it('excludes generic outro from required set check', () => {
    expect(KYC_DOCUMENT_TYPES.has('outro')).toBe(false);
  });
});
