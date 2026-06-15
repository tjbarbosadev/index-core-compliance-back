import { describe, it, expect } from 'vitest';
import { mapRestricted } from './cotista.service.js';

describe('cotista.service', () => {
  it('mapRestricted omits KYC fields for Gestor view (RN-005)', () => {
    const row = {
      id: 'c1',
      cpf_cnpj: '12345678901',
      legal_name: 'Investidor A',
      status: 'aprovado',
      bank_code: '001',
      branch: '0001',
      account: '12345-6',
    };
    const restricted = mapRestricted(row);
    expect(restricted).toEqual({
      id: 'c1',
      legalName: 'Investidor A',
      cpfCnpj: '12345678901',
      status: 'aprovado',
      bankCode: '001',
      branch: '0001',
      account: '12345-6',
    });
    expect(restricted).not.toHaveProperty('pepFlag');
    expect(restricted).not.toHaveProperty('documents');
  });
});
