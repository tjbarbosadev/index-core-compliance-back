import { describe, expect, it } from 'vitest';
import { cedenteFormFixture } from './cedente-form.fixture.js';
import {
  buildCedenteDocumentCatalog,
  extractSigners,
  findSlot,
  missingRequiredUploads,
} from './document-catalog.js';

describe('extractSigners', () => {
  it('lists the representative first, then administrators', () => {
    expect(extractSigners(cedenteFormFixture)).toEqual([
      {
        key: 'socio-0',
        name: 'Representante Legal',
        email: 'representante@example.com',
        cpf: '52998224725',
        role: 'representante',
      },
      {
        key: 'socio-1',
        name: 'Administrador Adicional',
        email: 'administrador@example.com',
        cpf: '11144477735',
        role: 'administrador',
      },
    ]);
  });

  it('deduplicates by CPF and ignores CNPJ administrators', () => {
    const form = {
      ...cedenteFormFixture,
      administradoresProcuradores: [
        { nomeRazaoSocial: 'Mesmo CPF', cpfCnpj: '529.982.247-25', tipo: 'procurador' },
        { nomeRazaoSocial: 'Holding', cpfCnpj: '11222333000181', tipo: 'administrador' },
      ],
    };
    expect(extractSigners(form).map((s) => s.name)).toEqual(['Representante Legal']);
  });

  it('ignores administrators when the flag is "nao"', () => {
    const form = { ...cedenteFormFixture, possuiAdministradoresProcuradores: 'nao' };
    expect(extractSigners(form)).toHaveLength(1);
  });
});

describe('buildCedenteDocumentCatalog', () => {
  it('adds ID, address proof and signature card slots per signer', () => {
    const keys = buildCedenteDocumentCatalog(cedenteFormFixture).map((s) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'contrato-social',
        'socio-0-identidade',
        'socio-0-comprovante',
        'socio-1-identidade',
        'socio-1-comprovante',
        'ficha-cadastral-pj',
        'socio-0-cartao-assinatura',
        'socio-1-cartao-assinatura',
      ]),
    );
  });

  it('marks generated slots as non-uploadable', () => {
    const generated = buildCedenteDocumentCatalog(cedenteFormFixture).filter(
      (s) => s.source === 'generated',
    );
    expect(generated.map((s) => s.type)).toEqual([
      'ficha_cadastral_pj',
      'cartao_assinatura',
      'cartao_assinatura',
    ]);
  });

  it('requires the power of attorney only for a procurador representative', () => {
    expect(findSlot(cedenteFormFixture, 'procuracao')?.required).toBe(false);
    expect(
      findSlot({ ...cedenteFormFixture, tipoRepresentante: 'procurador' }, 'procuracao')?.required,
    ).toBe(true);
  });

  it('returns null for slots outside the catalog', () => {
    expect(findSlot(cedenteFormFixture, 'socio-9-identidade')).toBeNull();
  });
});

describe('missingRequiredUploads', () => {
  it('lists required uploads not yet sent, never generated slots', () => {
    const missing = missingRequiredUploads(cedenteFormFixture, ['contrato-social', 'balanco']);
    const keys = missing.map((s) => s.key);
    expect(keys).toContain('dre');
    expect(keys).not.toContain('contrato-social');
    expect(keys).not.toContain('certidoes');
    expect(missing.every((s) => s.source === 'upload')).toBe(true);
  });
});
