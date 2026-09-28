import { z } from 'zod';
import { isValidCnpj, isValidCpf, isValidCpfOrCnpj } from '../lib/cedente/validators.js';

/**
 * PJ registration form for cedentes. Field names mirror the FIM PJ form
 * (nextcorefim `schemas/pj/blocks`) so the IndexCore ficha cadastral mapping applies unchanged.
 * Investor-only blocks (fund/quota/amount and suitability) are intentionally absent.
 */

const yesNo = z.enum(['sim', 'nao']).default('nao');
const required = (label: string) => z.string().trim().min(1, `${label} é obrigatório`);
const optionalText = z.string().trim().optional();

const cpf = z
  .string()
  .min(1, 'CPF é obrigatório')
  .refine((v) => isValidCpf(v), 'CPF inválido');
const cnpj = z
  .string()
  .min(1, 'CNPJ é obrigatório')
  .refine((v) => isValidCnpj(v), 'CNPJ inválido');
const cpfOrCnpj = z
  .string()
  .min(1, 'CPF/CNPJ é obrigatório')
  .refine((v) => isValidCpfOrCnpj(v), 'CPF ou CNPJ inválido');

const percentage = z.coerce
  .number({ invalid_type_error: 'Informe um percentual' })
  .min(0, 'Percentual não pode ser negativo')
  .max(100, 'Percentual não pode ultrapassar 100%');

function requireIf(
  ctx: z.RefinementCtx,
  condition: boolean,
  value: unknown,
  path: (string | number)[],
  message: string,
) {
  if (!condition) return;
  if (value === undefined || value === null || String(value).trim() === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  }
}

function requireList(
  ctx: z.RefinementCtx,
  flag: string | undefined,
  list: unknown[] | undefined,
  path: string,
  message: string,
) {
  if (flag === 'sim' && (!list || list.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
  }
}

function sumAtMost100(
  ctx: z.RefinementCtx,
  list: { [k: string]: unknown }[] | undefined,
  field: string,
  path: string,
) {
  if (!list?.length) return;
  const total = list.reduce((acc, item) => acc + Number(item[field] ?? 0), 0);
  if (total > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Soma dos percentuais não pode exceder 100%',
      path: [path],
    });
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Dados da empresa
// ---------------------------------------------------------------------------

export const cedenteEmpresaSchema = z
  .object({
    company: required('Razão social'),
    trade: required('Nome fantasia'),
    cnpj,
    date: required('Data de constituição'),
    tipoConstituicao: required('Tipo de constituição'),
    tipoConstituicaoOutros: optionalText,
    financialActivity: yesNo,
    bankruptcy: yesNo,
    judicialReorganization: yesNo,

    businessSector: required('Ramo de atividade'),
    cnaeActivity: required('Atividade CNAE'),
    economicActivity: required('Atividade econômica'),
    nire: required('NIRE'),
    exemptStateRegistration: yesNo,
    stateRegistration: optionalText,

    constitutionCountry: required('País de constituição'),
    homeCountry: required('País de origem'),
    legalNature: required('Natureza jurídica'),
    shareholderControl: required('Controle acionário'),

    paisDomicilioFiscal: optionalText,
    nif: optionalText,
    identificacaoFiscalExterior: optionalText,

    email: z.string().trim().min(1, 'E-mail é obrigatório').email('E-mail inválido'),
    website: optionalText,
    ddi1: required('DDI'),
    ddd1: required('DDD'),
    telefone1: required('Telefone'),
    ddi2: optionalText,
    ddd2: optionalText,
    telefone2: optionalText,

    iof: optionalText,
    irrf: optionalText,

    fatca: yesNo,
    politicallyExposed: yesNo,
    nonProfit: yesNo,
    bondCompany: yesNo,

    carteiraAdministrada: yesNo,
    administradorCarteiraNome: optionalText,
    administradorCarteiraCnpj: optionalText,
    gestorCarteiraNome: optionalText,
    gestorCarteiraCnpj: optionalText,

    possuiUsPersonParticipacao: yesNo,
    usPerson1Nome: optionalText,
    usPerson1Endereco: optionalText,
    usPerson1SsnTin: optionalText,
    usPerson2Nome: optionalText,
    usPerson2Endereco: optionalText,
    usPerson2SsnTin: optionalText,

    fatcaAtividadeFinanceira: yesNo,
    fatcaTipoInstituicao: optionalText,
    fatcaGiin: optionalText,
    fatcaMaisDe50ReceitaServicos: yesNo,
    fatcaEntidadeSemFinsLucrativos: yesNo,
    fatcaBeneficiarioFinalDeclaracao: required('Declaração de beneficiário final (FATCA)'),

    logradouro: required('Logradouro'),
    numero: required('Número'),
    complemento: optionalText,
    bairro: required('Bairro'),
    cidade: required('Cidade'),
    estado: z.string().trim().length(2, 'UF inválida'),
    cep: required('CEP'),
    pais: required('País'),

    tipoEntregaCorrespondencia: z.enum(['email', 'sede', 'outro', 'naoReceber'], {
      message: 'Selecione o tipo de entrega de correspondência',
    }),
    correspondenciaAosCuidados: optionalText,
    correspondenciaLogradouro: optionalText,
    correspondenciaNumero: optionalText,
    correspondenciaComplemento: optionalText,
    correspondenciaBairro: optionalText,
    correspondenciaCidade: optionalText,
    correspondenciaUf: optionalText,
    correspondenciaCep: optionalText,
    correspondenciaPais: optionalText,
    correspondenciaEmail: optionalText,

    patrimonioLiquido: required('Patrimônio líquido'),
    dataBasePatrimonio: required('Data base do patrimônio'),
    receitaLiquida: required('Receita líquida'),
    periodicidadeBalancete: required('Periodicidade do balancete'),
    faturamentoMedioMensal: required('Faturamento médio mensal'),
    faturamentoUltimoMes: required('Faturamento do último mês'),
    endividamentoFinanceiroTotal: optionalText,
    qualificacaoInvestidor: optionalText,

    possuiParticipacoesSocietarias: yesNo,
    possuiPlanoInvestidor: yesNo,
  })
  .superRefine((d, ctx) => {
    requireIf(
      ctx,
      d.tipoConstituicao === 'outros',
      d.tipoConstituicaoOutros,
      ['tipoConstituicaoOutros'],
      'Especifique o tipo de constituição',
    );
    requireIf(
      ctx,
      d.exemptStateRegistration === 'nao',
      d.stateRegistration,
      ['stateRegistration'],
      'Informe a inscrição estadual',
    );
    requireIf(
      ctx,
      d.carteiraAdministrada === 'sim',
      d.administradorCarteiraNome,
      ['administradorCarteiraNome'],
      'Informe o administrador da carteira',
    );
    requireIf(
      ctx,
      d.possuiUsPersonParticipacao === 'sim',
      d.usPerson1Nome,
      ['usPerson1Nome'],
      'Informe o nome da US Person',
    );
    requireIf(
      ctx,
      d.fatcaAtividadeFinanceira === 'sim',
      d.fatcaTipoInstituicao,
      ['fatcaTipoInstituicao'],
      'Selecione o tipo de instituição financeira (FATCA)',
    );
    const otherAddress = d.tipoEntregaCorrespondencia === 'outro';
    for (const [field, label] of [
      ['correspondenciaLogradouro', 'o endereço de correspondência'],
      ['correspondenciaNumero', 'o número'],
      ['correspondenciaBairro', 'o bairro'],
      ['correspondenciaCidade', 'a cidade'],
      ['correspondenciaUf', 'a UF'],
      ['correspondenciaCep', 'o CEP'],
      ['correspondenciaPais', 'o país'],
    ] as const) {
      requireIf(ctx, otherAddress, d[field], [field], `Informe ${label}`);
    }
    requireIf(
      ctx,
      d.tipoEntregaCorrespondencia === 'email' || otherAddress,
      d.correspondenciaEmail,
      ['correspondenciaEmail'],
      'Informe o e-mail para correspondência',
    );
  });

// ---------------------------------------------------------------------------
// Step 2 — Representantes, sócios, UBO, contas
// ---------------------------------------------------------------------------

const acionistaSchema = z.object({
  nome: required('Nome / razão social'),
  cpfCnpj: cpfOrCnpj,
  paisConstituicao: required('País de constituição'),
  capitalVotante: percentage,
  capitalTotal: percentage,
});

const beneficiarioSchema = z.object({
  nome: required('Nome'),
  cpfCnpj: cpfOrCnpj,
  nacionalidade: required('Nacionalidade'),
  participacaoPercentual: percentage.refine((v) => v > 0, 'Participação deve ser maior que 0'),
  outraCidadania: yesNo,
  nifNumero: optionalText,
  nifPais: optionalText,
  pepFlag: z.boolean().default(false),
});

const empresaRelacionadaSchema = z.object({
  empresa: required('Empresa'),
  cnpj,
  capitalTotal: percentage,
});

const controladorSchema = z.object({
  nomeRazaoSocial: required('Nome / razão social'),
  cpfCnpj: cpfOrCnpj,
  docIdentidade: required('Documento de identidade'),
});

const contaBancariaSchema = z.object({
  tipo: required('Tipo de conta'),
  banco: required('Banco'),
  agenciaNumero: z.string().regex(/^\d+$/, 'Agência deve conter apenas dígitos'),
  agenciaNome: required('Nome da agência'),
  contaCorrente: z.string().regex(/^\d+$/, 'Conta deve conter apenas dígitos'),
  digito: z.string().regex(/^[0-9Xx]{1,2}$/, 'Dígito inválido'),
});

const administradorSchema = z.object({
  tipo: z.enum(['administrador', 'procurador'], { message: 'Selecione o tipo' }),
  nomeRazaoSocial: required('Nome / razão social'),
  email: z.string().trim().email('E-mail inválido'),
  cpfCnpj: cpfOrCnpj,
  docIdentidade: required('Documento de identidade'),
});

const responsavelSchema = z.object({
  nome: required('Nome'),
  cpf,
  cargo: required('Cargo'),
});

export const cedenteEstruturaSchema = z
  .object({
    tipoRepresentante: z.enum(['administrador', 'procurador'], {
      message: 'Selecione o tipo de representante',
    }),
    representanteNome: required('Nome do representante'),
    representanteEmail: z.string().trim().email('E-mail do representante inválido'),
    representanteCpf: cpf,
    representanteRg: required('RG do representante'),

    possuiAcionistasSocios: yesNo,
    acionistasSocios: z.array(acionistaSchema).optional(),

    clienteCompanhiaAbertaOuSemFinsLucrativos: yesNo,
    possuiBeneficiariosFinais: yesNo,
    beneficiariosFinais: z.array(beneficiarioSchema).optional(),

    possuiEmpresasColigadas: yesNo,
    empresasColigadas: z.array(empresaRelacionadaSchema).optional(),
    possuiEmpresasControladas: yesNo,
    empresasControladas: z.array(empresaRelacionadaSchema).optional(),

    possuiControladoresDiretores: yesNo,
    controladoresDiretores: z.array(controladorSchema).optional(),

    contasBancarias: z
      .array(contaBancariaSchema)
      .min(1, 'Adicione pelo menos uma conta bancária')
      .max(3, 'Máximo de 3 contas bancárias'),

    possuiAdministradoresProcuradores: yesNo,
    administradoresProcuradores: z.array(administradorSchema).optional(),

    possuiResponsaveis: yesNo,
    responsaveis: z.array(responsavelSchema).optional(),
  })
  .superRefine((d, ctx) => {
    requireList(
      ctx,
      d.possuiAcionistasSocios,
      d.acionistasSocios,
      'acionistasSocios',
      'Adicione pelo menos um acionista/sócio',
    );
    sumAtMost100(ctx, d.acionistasSocios, 'capitalVotante', 'acionistasSocios');
    sumAtMost100(ctx, d.acionistasSocios, 'capitalTotal', 'acionistasSocios');

    if (d.clienteCompanhiaAbertaOuSemFinsLucrativos !== 'sim') {
      requireList(
        ctx,
        'sim',
        d.beneficiariosFinais,
        'beneficiariosFinais',
        'Informe ao menos um beneficiário final (UBO)',
      );
    }
    sumAtMost100(ctx, d.beneficiariosFinais, 'participacaoPercentual', 'beneficiariosFinais');

    requireList(
      ctx,
      d.possuiEmpresasColigadas,
      d.empresasColigadas,
      'empresasColigadas',
      'Adicione pelo menos uma empresa coligada',
    );
    sumAtMost100(ctx, d.empresasColigadas, 'capitalTotal', 'empresasColigadas');
    requireList(
      ctx,
      d.possuiEmpresasControladas,
      d.empresasControladas,
      'empresasControladas',
      'Adicione pelo menos uma empresa controlada',
    );
    sumAtMost100(ctx, d.empresasControladas, 'capitalTotal', 'empresasControladas');
    requireList(
      ctx,
      d.possuiControladoresDiretores,
      d.controladoresDiretores,
      'controladoresDiretores',
      'Adicione pelo menos um controlador/diretor',
    );
    requireList(
      ctx,
      d.possuiAdministradoresProcuradores,
      d.administradoresProcuradores,
      'administradoresProcuradores',
      'Adicione pelo menos um administrador ou procurador',
    );
    requireList(
      ctx,
      d.possuiResponsaveis,
      d.responsaveis,
      'responsaveis',
      'Adicione pelo menos um responsável',
    );
  });

export type CedenteEmpresaData = z.infer<typeof cedenteEmpresaSchema>;
export type CedenteEstruturaData = z.infer<typeof cedenteEstruturaSchema>;
export type CedentePjForm = CedenteEmpresaData & CedenteEstruturaData;

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || 'formulário'}: ${i.message}`)
    .join('; ');
}
