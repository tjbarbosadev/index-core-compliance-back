import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, sumPl } = vi.hoisted(() => ({
  prismaMock: {
    fund: { findUnique: vi.fn() },
    fundInvestment: { groupBy: vi.fn() },
    complianceRule: { findMany: vi.fn() },
  },
  sumPl: vi.fn(),
}));

vi.mock('../db/index.js', () => ({ prisma: prismaMock }));
vi.mock('./fund-pl.service.js', () => ({ sumFundNetWorthFromLinks: sumPl }));

import { computeFundComplianceStatus } from './compliance-fund.service.js';

function setup(opts: {
  modality: string;
  limits: Record<string, number>;
  pl: number;
  investments: Record<string, number>;
}) {
  prismaMock.fund.findUnique.mockResolvedValue({
    id: 'f1',
    modality: opts.modality,
    regulatoryLimitsJson: opts.limits,
  });
  sumPl.mockResolvedValue(opts.pl);
  prismaMock.fundInvestment.groupBy.mockResolvedValue(
    Object.entries(opts.investments).map(([assetClass, amount]) => ({
      assetClass,
      _sum: { amount },
    })),
  );
  prismaMock.complianceRule.findMany.mockResolvedValue([]);
}

describe('computeFundComplianceStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the FIDC 67% DC rule', async () => {
    setup({
      modality: 'fidc',
      limits: { min_direitos_creditorios_pct: 67 },
      pl: 1000,
      investments: { direito_creditorio: 500 },
    });
    const res = await computeFundComplianceStatus('f1');
    expect(res?.statusCompliance).toBe('violacao');
    expect(res?.limiteMinimo).toBe(67);
    expect(res?.violacoes[0]).toContain('abaixo do mínimo 67%');
  });

  it('falls back to the default DC minimum for FIDC without limits', async () => {
    setup({ modality: 'fidc', limits: {}, pl: 0, investments: {} });
    const res = await computeFundComplianceStatus('f1');
    expect(res?.limiteMinimo).toBe(67);
    expect(res?.statusCompliance).toBe('violacao');
  });

  it('evaluates custom maximum limits on a FIM', async () => {
    const limits = { max_acoes_pct: 30, min_renda_fixa_pct: 50 };

    setup({ modality: 'fim', limits, pl: 1000, investments: { acoes: 200, renda_fixa: 600 } });
    expect((await computeFundComplianceStatus('f1'))?.statusCompliance).toBe('conforme');

    setup({ modality: 'fim', limits, pl: 1000, investments: { acoes: 280, renda_fixa: 600 } });
    expect((await computeFundComplianceStatus('f1'))?.statusCompliance).toBe('alerta');

    setup({ modality: 'fim', limits, pl: 1000, investments: { acoes: 400, renda_fixa: 600 } });
    const res = await computeFundComplianceStatus('f1');
    expect(res?.statusCompliance).toBe('violacao');
    expect(res?.violacoes).toEqual(['Ações 40.00% acima do máximo 30%']);
    expect(res?.limites).toHaveLength(2);
  });

  it('skips custom limits when the fund has no net worth', async () => {
    setup({ modality: 'fim', limits: { min_renda_fixa_pct: 50 }, pl: 0, investments: {} });
    const res = await computeFundComplianceStatus('f1');
    expect(res?.statusCompliance).toBe('conforme');
    expect(res?.limites).toEqual([]);
  });
});
