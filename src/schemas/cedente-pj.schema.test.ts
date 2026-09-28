import { describe, expect, it } from 'vitest';
import { empresaFixture, estruturaFixture } from '../lib/cedente/cedente-form.fixture.js';
import { isValidCnpj, isValidCpf } from '../lib/cedente/validators.js';
import {
  cedenteEmpresaSchema,
  cedenteEstruturaSchema,
  formatZodIssues,
} from './cedente-pj.schema.js';

function issuePaths(result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) {
  return result.error?.issues.map((i) => i.path.join('.')) ?? [];
}

describe('cedente validators', () => {
  it('accepts valid CPF/CNPJ with or without mask', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('rejects wrong check digits and repeated digits', () => {
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
});

describe('cedenteEmpresaSchema', () => {
  it('accepts a complete company block', () => {
    expect(cedenteEmpresaSchema.safeParse(empresaFixture).success).toBe(true);
  });

  it('rejects an invalid CNPJ', () => {
    const result = cedenteEmpresaSchema.safeParse({ ...empresaFixture, cnpj: '11222333000180' });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('cnpj');
  });

  it('requires the company name', () => {
    const result = cedenteEmpresaSchema.safeParse({ ...empresaFixture, company: '  ' });
    expect(issuePaths(result)).toContain('company');
  });
});

describe('cedenteEstruturaSchema', () => {
  it('accepts a complete structure block', () => {
    expect(cedenteEstruturaSchema.safeParse(estruturaFixture).success).toBe(true);
  });

  it('requires at least one bank account', () => {
    const result = cedenteEstruturaSchema.safeParse({ ...estruturaFixture, contasBancarias: [] });
    expect(issuePaths(result)).toContain('contasBancarias');
  });

  it('requires beneficial owners unless the company is listed or non-profit', () => {
    const withoutUbo = { ...estruturaFixture, beneficiariosFinais: [] };
    expect(issuePaths(cedenteEstruturaSchema.safeParse(withoutUbo))).toContain(
      'beneficiariosFinais',
    );
    expect(
      cedenteEstruturaSchema.safeParse({
        ...withoutUbo,
        clienteCompanhiaAbertaOuSemFinsLucrativos: 'sim',
      }).success,
    ).toBe(true);
  });

  it('requires the list when its yes/no flag is "sim"', () => {
    const result = cedenteEstruturaSchema.safeParse({
      ...estruturaFixture,
      administradoresProcuradores: [],
    });
    expect(issuePaths(result)).toContain('administradoresProcuradores');
  });

  it('rejects shareholder percentages above 100%', () => {
    const result = cedenteEstruturaSchema.safeParse({
      ...estruturaFixture,
      acionistasSocios: [
        ...estruturaFixture.acionistasSocios,
        { ...estruturaFixture.acionistasSocios[0], capitalTotal: 40, capitalVotante: 40 },
      ],
    });
    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error!)).toMatch(/não pode exceder 100%/);
  });

  it('rejects an invalid representative CPF', () => {
    const result = cedenteEstruturaSchema.safeParse({
      ...estruturaFixture,
      representanteCpf: '12345678900',
    });
    expect(issuePaths(result)).toContain('representanteCpf');
  });
});
