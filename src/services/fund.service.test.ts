import { describe, it, expect } from 'vitest';
import { DEFAULT_REGULATORY_LIMITS } from '../lib/errors.js';

describe('fund regulatory limits', () => {
  it('FIDC has 67% DC limit', () => {
    expect(DEFAULT_REGULATORY_LIMITS.fidc.min_direitos_creditorios_pct).toBe(67);
  });

  it('FII has 75% imoveis limit', () => {
    expect(DEFAULT_REGULATORY_LIMITS.fii.min_imoveis_pct).toBe(75);
  });
});
