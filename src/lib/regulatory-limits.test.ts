import { describe, expect, it } from 'vitest';
import { buildLimitKey, evaluateLimit, parseLimitKey, worstStatus } from './regulatory-limits.js';

describe('parseLimitKey', () => {
  it('parses min and max keys for known asset classes', () => {
    expect(parseLimitKey('max_acoes_pct')).toEqual({ kind: 'max', assetClass: 'acoes' });
    expect(parseLimitKey('min_cotas_fundo_investimento_pct')).toEqual({
      kind: 'min',
      assetClass: 'cotas_fundo_investimento',
    });
  });

  it('maps the legacy FIDC key to direito_creditorio', () => {
    expect(parseLimitKey('min_direitos_creditorios_pct')).toEqual({
      kind: 'min',
      assetClass: 'direito_creditorio',
    });
  });

  it('ignores keys without a matching asset class', () => {
    expect(parseLimitKey('min_participacoes_pct')).toBeNull();
    expect(parseLimitKey('direito_creditorio_min')).toBeNull();
  });

  it('round-trips with buildLimitKey', () => {
    expect(parseLimitKey(buildLimitKey('max', 'imoveis'))).toEqual({
      kind: 'max',
      assetClass: 'imoveis',
    });
  });
});

describe('evaluateLimit', () => {
  it('evaluates minimum limits with warning band', () => {
    expect(evaluateLimit('min', 67, 70, 90)).toBe('conforme');
    expect(evaluateLimit('min', 67, 65, 90)).toBe('alerta');
    expect(evaluateLimit('min', 67, 50, 90)).toBe('violacao');
  });

  it('evaluates maximum limits with warning band', () => {
    expect(evaluateLimit('max', 30, 20, 90)).toBe('conforme');
    expect(evaluateLimit('max', 30, 28, 90)).toBe('alerta');
    expect(evaluateLimit('max', 30, 30, 90)).toBe('alerta');
    expect(evaluateLimit('max', 30, 31, 90)).toBe('violacao');
  });
});

describe('worstStatus', () => {
  it('returns the most severe status', () => {
    expect(worstStatus([])).toBe('conforme');
    expect(worstStatus(['conforme', 'alerta'])).toBe('alerta');
    expect(worstStatus(['alerta', 'violacao', 'conforme'])).toBe('violacao');
  });
});
