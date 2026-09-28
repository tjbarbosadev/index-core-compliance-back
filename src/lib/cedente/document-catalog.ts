import type { DocumentType } from '@prisma/client';

export type CedenteDocumentSlot = {
  key: string;
  label: string;
  type: DocumentType;
  required: boolean;
  /** `generated` slots are produced by the system (PDF + ZapSign), never uploaded manually. */
  source: 'upload' | 'generated';
  hint?: string;
};

export type CedenteSigner = {
  key: string;
  name: string;
  email: string;
  cpf: string;
  role: 'representante' | 'administrador' | 'procurador';
};

const ADDRESS_HINT = 'Emitido nos últimos 90 dias.';
const ACCOUNTANT_HINT = 'Assinado pelo contador e pelos administradores.';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function digits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Legal representative + administrators/procuradores with a CPF, deduplicated by CPF.
 * These people sign the ficha cadastral / signature cards and must send ID + address proof.
 */
export function extractSigners(form: Record<string, unknown>): CedenteSigner[] {
  const people: Omit<CedenteSigner, 'key'>[] = [];
  const representativeCpf = digits(form.representanteCpf);
  if (representativeCpf) {
    people.push({
      name: String(form.representanteNome ?? 'Representante legal').trim(),
      email: String(form.representanteEmail ?? '').trim(),
      cpf: representativeCpf,
      role: 'representante',
    });
  }

  if (
    form.possuiAdministradoresProcuradores === 'sim' &&
    Array.isArray(form.administradoresProcuradores)
  ) {
    for (const raw of form.administradoresProcuradores) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const cpf = digits(row.cpfCnpj);
      if (cpf.length !== 11 || people.some((p) => p.cpf === cpf)) continue;
      people.push({
        name: String(row.nomeRazaoSocial ?? 'Administrador').trim(),
        email: String(row.email ?? '').trim(),
        cpf,
        role: row.tipo === 'procurador' ? 'procurador' : 'administrador',
      });
    }
  }

  return people.map((p, index) => ({ ...p, key: `socio-${index}` }));
}

export function buildCedenteDocumentCatalog(
  form: Record<string, unknown> = {},
): CedenteDocumentSlot[] {
  const company: CedenteDocumentSlot[] = [
    {
      key: 'contrato-social',
      label: 'Último contrato social consolidado',
      type: 'contrato_social',
      required: true,
      source: 'upload',
    },
    {
      key: 'comprovante-endereco-empresa',
      label: 'Comprovante de endereço da empresa',
      type: 'comprovante_endereco_empresa',
      required: true,
      source: 'upload',
      hint: ADDRESS_HINT,
    },
    {
      key: 'balanco',
      label: 'Balanço patrimonial do último exercício',
      type: 'balanco_patrimonial',
      required: true,
      source: 'upload',
      hint: ACCOUNTANT_HINT,
    },
    {
      key: 'dre',
      label: 'Demonstração do Resultado do Exercício (DRE)',
      type: 'dre',
      required: true,
      source: 'upload',
      hint: ACCOUNTANT_HINT,
    },
    {
      key: 'declaracao-faturamento',
      label: 'Declaração de faturamento dos últimos 12 meses',
      type: 'declaracao_faturamento',
      required: true,
      source: 'upload',
      hint: ACCOUNTANT_HINT,
    },
    {
      key: 'minuta-cessao',
      label: 'Minuta do termo de cessão',
      type: 'minuta_cessao',
      required: true,
      source: 'upload',
      hint: 'Analisada pelo jurídico antes da aprovação.',
    },
  ];

  const people = extractSigners(form).flatMap<CedenteDocumentSlot>((signer) => [
    {
      key: `${signer.key}-identidade`,
      label: `RG, CNH, RNE ou passaporte — ${signer.name}`,
      type: 'identidade_representante',
      required: true,
      source: 'upload',
    },
    {
      key: `${signer.key}-comprovante`,
      label: `Comprovante de endereço — ${signer.name}`,
      type: 'comprovante_endereco_representante',
      required: true,
      source: 'upload',
      hint: ADDRESS_HINT,
    },
  ]);

  const optional: CedenteDocumentSlot[] = [
    {
      key: 'alteracao-contratual',
      label: 'Alterações contratuais posteriores',
      type: 'alteracao_contratual',
      required: false,
      source: 'upload',
    },
    {
      key: 'procuracao',
      label: 'Procuração (quando o representante for procurador)',
      type: 'procuracao',
      required: form.tipoRepresentante === 'procurador',
      source: 'upload',
    },
    {
      key: 'certidoes',
      label: 'Certidões negativas (federal, estadual, trabalhista)',
      type: 'certidao',
      required: false,
      source: 'upload',
    },
    {
      key: 'extrato-bancario',
      label: 'Extrato bancário (últimos 90 dias)',
      type: 'extrato_bancario',
      required: false,
      source: 'upload',
    },
  ];

  const generated: CedenteDocumentSlot[] = [
    {
      key: 'ficha-cadastral-pj',
      label: 'Ficha cadastral PJ (IndexCore)',
      type: 'ficha_cadastral_pj',
      required: true,
      source: 'generated',
      hint: 'Gerada pelo sistema e assinada via ZapSign.',
    },
    ...extractSigners(form).map<CedenteDocumentSlot>((signer) => ({
      key: `${signer.key}-cartao-assinatura`,
      label: `Cartão de assinatura — ${signer.name}`,
      type: 'cartao_assinatura',
      required: true,
      source: 'generated',
      hint: 'Gerado pelo sistema e assinado via ZapSign.',
    })),
  ];

  return [...company, ...people, ...optional, ...generated];
}

export function findSlot(form: Record<string, unknown>, slot: string) {
  return buildCedenteDocumentCatalog(form).find((s) => s.key === slot) ?? null;
}

export function missingRequiredUploads(
  form: Record<string, unknown>,
  uploadedSlots: Iterable<string>,
): CedenteDocumentSlot[] {
  const uploaded = new Set(uploadedSlots);
  return buildCedenteDocumentCatalog(form).filter(
    (s) => s.source === 'upload' && s.required && !uploaded.has(s.key),
  );
}
