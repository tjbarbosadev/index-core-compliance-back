type Dict = Record<string, unknown>;

/** CNPJ do Next Core FIDC (fundo alvo das propostas do site nextcorefidc.com.br). */
export const NEXAFIDIC_FUND_CNPJ = '68057459000165';

function renameKeys(obj: Dict, map: Record<string, string>): Dict {
  const out: Dict = { ...obj };
  for (const [from, to] of Object.entries(map)) {
    if (from in out) {
      out[to] = out[from];
      if (from !== to) delete out[from];
    }
  }
  return out;
}

function remapArrayItems(obj: Dict, key: string, map: Record<string, string>): void {
  const arr = obj[key];
  if (Array.isArray(arr)) {
    obj[key] = arr.map((item) =>
      item && typeof item === 'object' ? renameKeys(item as Dict, map) : item,
    );
  }
}

export function isNexafidicPj(raw: Dict): boolean {
  return typeof raw.company === 'string' && raw.company.trim().length > 0;
}

export function normalizeNexafidicPayload(raw: Dict): Dict {
  if (!isNexafidicPj(raw)) {
    return renameKeys(raw, {
      pessoaVinculadaSefer: 'pessoaVinculadaIndexCore',
      qualificacaoInvestidor: 'qualificacao',
    });
  }
  const out: Dict = { ...raw };
  const pessoaMap = { nomeRazaoSocial: 'nome', docIdentidade: 'documentoIdentidade' };
  remapArrayItems(out, 'administradoresProcuradores', pessoaMap);
  remapArrayItems(out, 'controladoresDiretores', pessoaMap);
  remapArrayItems(out, 'contasBancarias', { agenciaNumero: 'agencia', contaCorrente: 'conta' });
  remapArrayItems(out, 'beneficiariosFinais', { nifPais: 'outraCidadaniaPaises' });
  return out;
}

function str(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export type NexafidicProposalSummary = {
  partyType: 'pf' | 'pj';
  cpfCnpj: string;
  legalName: string;
  email?: string;
  phone?: string;
};

export function summarizeNexafidicPayload(normalized: Dict): NexafidicProposalSummary {
  const isPj = isNexafidicPj(normalized);
  const email = str(normalized.email);
  const phone = isPj
    ? [str(normalized.ddd1), str(normalized.telefone1)].filter(Boolean).join(' ')
    : str(normalized.residencialTelefone) || str(normalized.phone);
  return {
    partyType: isPj ? 'pj' : 'pf',
    cpfCnpj: str(isPj ? normalized.cnpj : normalized.cpf).replace(/\D/g, ''),
    legalName: isPj ? str(normalized.company) || str(normalized.razaoSocial) : str(normalized.name),
    email: email.includes('@') ? email : undefined,
    phone: phone ? phone.slice(0, 30) : undefined,
  };
}
