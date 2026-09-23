import { describe, expect, it } from 'vitest';
import { toPartnerFund } from './fund.service.js';

describe('toPartnerFund', () => {
  it('exposes catalog fields without sensitive data', () => {
    const partner = toPartnerFund({
      id: 'fund-1',
      name: 'Next Core FIDC',
      legalName: 'NEXT CORE FIDC LTDA',
      modality: 'fidc',
      status: 'ativo',
      website: 'https://nextcorefidc.com.br',
      description: 'FIDC com cotas sênior',
      targetAudience: 'Investidores qualificados',
      inceptionDate: new Date('2025-10-16'),
      extraInfoJson: {
        quotaClasses: [
          {
            name: 'Cota Sênior I',
            targetYield: 'CDI + 4% a.a.',
            termMonths: 12,
            minAmount: 10000,
          },
        ],
        regulator: 'CVM',
      },
    });

    expect(partner).toEqual({
      id: 'fund-1',
      name: 'Next Core FIDC',
      legalName: 'NEXT CORE FIDC LTDA',
      modality: 'fidc',
      status: 'ativo',
      website: 'https://nextcorefidc.com.br',
      description: 'FIDC com cotas sênior',
      targetAudience: 'Investidores qualificados',
      inceptionDate: '2025-10-16',
      quotaClasses: [
        {
          name: 'Cota Sênior I',
          targetYield: 'CDI + 4% a.a.',
          termMonths: 12,
        },
      ],
    });

    const json = JSON.stringify(partner);
    expect(json).not.toMatch(/cnpj/i);
    expect(json).not.toMatch(/bank/i);
    expect(json).not.toMatch(/pix/i);
    expect(json).not.toMatch(/shareholder/i);
    expect(json).not.toMatch(/netWorth/i);
    expect(json).not.toMatch(/minAmount/);
    expect(json).not.toMatch(/contactEmail|contactPhone|registeredAddress/i);
  });
});
