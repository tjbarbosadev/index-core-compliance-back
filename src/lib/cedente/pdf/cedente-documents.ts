import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentType } from '@prisma/client';
import { env } from '../../env.js';
import { extractSigners, type CedenteSigner } from '../document-catalog.js';
import { fillDocx } from './docx-filler.js';

/** ZapSign anchors — must match the text left in the DOCX templates. */
export const CLIENT_ANCHOR = '{{assinaturaCliente}}';
export const INDEX_ANCHOR = '{{assinaturaIndex}}';

type Values = Record<string, string>;
type Form = Record<string, unknown>;

export type GeneratedCedenteDocument = {
  slot: string;
  type: DocumentType;
  title: string;
  fileBaseName: string;
  docx: Uint8Array;
  /** Who signs this document and where. */
  signers: { signer: CedenteSigner | 'index'; anchor: string }[];
};

const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const simNao = (v: unknown) => (v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : '');
const mapText = (map: Record<string, string>, v: unknown) => (v ? (map[String(v)] ?? s(v)) : '');
const list = (form: Form, key: string) =>
  (Array.isArray(form[key]) ? form[key] : []) as Record<string, unknown>[];

const BRAZIL = ['BR', 'BRA', 'Brasil', 'BRASIL', 'brasil', 'brazil', 'Brazil'];

const TIPO_CONSTITUICAO: Record<string, string> = {
  saCapitalAberto: 'S/A (capital aberto)',
  saCapitalFechado: 'S/A (capital fechado)',
  ltda: 'LTDA',
  outros: 'Outras',
};
const REGIME_TRIBUTARIO: Record<string, string> = {
  imune: 'Imune',
  isento: 'Isento',
  tributado: 'Tributado',
};
const METODO_CORRESPONDENCIA: Record<string, string> = {
  email: 'E-mail',
  sede: 'Sede',
  outro: 'Outro',
  naoReceber: 'Não receber',
};
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function localDataTexto(cidade?: string, now = new Date()): string {
  const data = `${now.getDate()} de ${MESES[now.getMonth()]} de ${now.getFullYear()}`;
  return cidade ? `${cidade}, ${data}` : data;
}

export function fichaCadastralValues(form: Form, now = new Date()): Values {
  const v: Values = {
    tipoCadastro: 'Cadastro',
    codigoUsoInterno: '',
    domiciliadoExterior: form.pais && !BRAZIL.includes(s(form.pais)) ? 'Sim' : 'Não',
    razaoSocial: s(form.company),
    ramoAtividade: s(form.businessSector),
    dataConstituicao: s(form.date),
    paisConstituicao: s(form.constitutionCountry),
    tipoConstituicao: mapText(TIPO_CONSTITUICAO, form.tipoConstituicao),
    tipoConstituicaoOutros: s(form.tipoConstituicaoOutros),
    cnpj: s(form.cnpj),
    codigoCnae: s(form.cnaeActivity),
    nomeFantasia: s(form.trade),
    website: s(form.website),
    email: s(form.email),
    nire: s(form.nire),
    paisDomicilioFiscal: s(form.paisDomicilioFiscal),
    nif: s(form.nif),
    identificacaoFiscalExterior: s(form.identificacaoFiscalExterior),
    regimeTributario: mapText(REGIME_TRIBUTARIO, form.irrf),
    enderecoSede: s(form.logradouro),
    numero: s(form.numero),
    complemento: s(form.complemento),
    bairro: s(form.bairro),
    cidade: s(form.cidade),
    uf: s(form.estado),
    cep: s(form.cep),
    pais: s(form.pais),
    ddi1: s(form.ddi1),
    ddd1: s(form.ddd1),
    telefone1: s(form.telefone1),
    ddi2: s(form.ddi2),
    ddd2: s(form.ddd2),
    telefone2: s(form.telefone2),
    metodoEntregaCorrespondencia: mapText(METODO_CORRESPONDENCIA, form.tipoEntregaCorrespondencia),
    emailCorrespondencia: s(form.correspondenciaEmail),
    aosCuidadosDe: s(form.correspondenciaAosCuidados),
    enderecoCorrespondencia: s(form.correspondenciaLogradouro),
    numeroCorrespondencia: s(form.correspondenciaNumero),
    complementoCorrespondencia: s(form.correspondenciaComplemento),
    bairroCorrespondencia: s(form.correspondenciaBairro),
    cidadeCorrespondencia: s(form.correspondenciaCidade),
    ufCorrespondencia: s(form.correspondenciaUf),
    cepCorrespondencia: s(form.correspondenciaCep),
    paisCorrespondencia: s(form.correspondenciaPais),
    carteiraAdministrada: simNao(form.carteiraAdministrada),
    administradorCarteira: s(form.administradorCarteiraNome),
    cnpjAdministradorCarteira: s(form.administradorCarteiraCnpj),
    gestorCarteira: s(form.gestorCarteiraNome),
    cnpjGestorCarteira: s(form.gestorCarteiraCnpj),
    pessoaFisicaParticipacaoSubstancialEUA: simNao(form.possuiUsPersonParticipacao),
    nomePessoaFisicaEUA1: s(form.usPerson1Nome),
    enderecoPessoaFisicaEUA1: s(form.usPerson1Endereco),
    ssnPessoaFisicaEUA1: s(form.usPerson1SsnTin),
    nomePessoaFisicaEUA2: s(form.usPerson2Nome),
    enderecoPessoaFisicaEUA2: s(form.usPerson2Endereco),
    ssnPessoaFisicaEUA2: s(form.usPerson2SsnTin),
    numeroGIIN: s(form.fatcaGiin),
    fatcaPFFI: form.fatcaTipoInstituicao === 'pffi' ? 'X' : '',
    fatcaDCFFI: form.fatcaTipoInstituicao === 'registeredDcffi' ? 'X' : '',
    atividadeMercadoRegulamentado: simNao(form.fatcaAtividadeFinanceira),
    receitaAtivosEstritosAtividade: simNao(form.fatcaMaisDe50ReceitaServicos),
    entidadeSemFinsLucrativosOuOrgaoGovernamental: simNao(form.fatcaEntidadeSemFinsLucrativos),
    beneficiarioFinalEfetivo:
      form.fatcaBeneficiarioFinalDeclaracao === 'beneficiarioEfetivo' ? 'X' : '',
    operaContaTerceiros:
      form.fatcaBeneficiarioFinalDeclaracao === 'operaPorContaTerceiros' ? 'X' : '',
    clienteCiaAbertaOuSemFinsLucrativos: simNao(form.clienteCompanhiaAbertaOuSemFinsLucrativos),
    patrimonioLiquido: s(form.patrimonioLiquido),
    dataBasePatrimonio: s(form.dataBasePatrimonio),
    endividamentoFinanceiroTotal: s(form.endividamentoFinanceiroTotal),
    faturamentoMedioMensal: s(form.faturamentoMedioMensal),
    localData: localDataTexto(s(form.cidade) || undefined, now),
    localDataIndex: localDataTexto('Barueri', now),
  };

  list(form, 'acionistasSocios')
    .slice(0, 5)
    .forEach((a, i) => {
      const n = i + 1;
      v[`razaoSocialAcionista${n}`] = s(a.nome);
      v[`cnpjCpfAcionista${n}`] = s(a.cpfCnpj);
      v[`paisConstituicaoAcionista${n}`] = s(a.paisConstituicao);
      v[`capitalVotanteAcionista${n}`] = s(a.capitalVotante);
      v[`capitalTotalAcionista${n}`] = s(a.capitalTotal);
    });

  const participadas = [...list(form, 'empresasColigadas'), ...list(form, 'empresasControladas')];
  participadas.slice(0, 3).forEach((p, i) => {
    const n = i + 1;
    v[`empresaParticipada${n}`] = s(p.empresa);
    v[`cnpjParticipada${n}`] = s(p.cnpj);
    v[`capitalTotalParticipada${n}`] = s(p.capitalTotal);
  });

  list(form, 'controladoresDiretores')
    .slice(0, 3)
    .forEach((c, i) => {
      const n = i + 1;
      v[`nomeControlador${n}`] = s(c.nomeRazaoSocial);
      v[`cpfCnpjControlador${n}`] = s(c.cpfCnpj);
      v[`docIdentidadeControlador${n}`] = s(c.docIdentidade);
    });

  list(form, 'administradoresProcuradores')
    .slice(0, 3)
    .forEach((a, i) => {
      const n = i + 1;
      v[`nomeAdministrador${n}`] = s(a.nomeRazaoSocial);
      v[`cpfCnpjAdministrador${n}`] = s(a.cpfCnpj);
      v[`docIdentidadeAdministrador${n}`] = s(a.docIdentidade);
    });

  list(form, 'contasBancarias')
    .slice(0, 3)
    .forEach((c, i) => {
      const n = i + 1;
      v[`banco${n}`] = s(c.banco);
      v[`agencia${n}`] = `${s(c.agenciaNumero)}${c.agenciaNome ? ` - ${s(c.agenciaNome)}` : ''}`;
      v[`contaCorrente${n}`] = c.contaCorrente ? `${s(c.contaCorrente)}-${s(c.digito)}` : '';
    });

  list(form, 'beneficiariosFinais')
    .slice(0, 5)
    .forEach((b, i) => {
      const n = i + 1;
      v[`nomeBeneficiario${n}`] = s(b.nome);
      v[`cnpjCpfBeneficiario${n}`] = s(b.cpfCnpj);
      v[`nacionalidadeBeneficiario${n}`] = s(b.nacionalidade);
      v[`participacaoBeneficiario${n}`] = s(b.participacaoPercentual);
      v[`numeroIdentidadePaisBeneficiario${n}`] = s(b.nifNumero);
      v[`outraCidadaniaBeneficiario${n}`] = simNao(b.outraCidadania);
      v[`paisesCidadaniaBeneficiario${n}`] = s(b.nifPais);
    });

  // The signature anchors are plain text in the template and must survive the fill.
  v.assinaturaCliente = CLIENT_ANCHOR;
  v.assinaturaIndex = INDEX_ANCHOR;
  return v;
}

export function cartaoAssinaturaValues(signer: CedenteSigner, form: Form): Values {
  const isRepresentative = signer.role === 'representante';
  const administrator = list(form, 'administradoresProcuradores').find(
    (a) => s(a.cpfCnpj).replace(/\D/g, '') === signer.cpf,
  );
  const tipo = isRepresentative
    ? form.tipoRepresentante === 'procurador'
      ? 'Procurador'
      : 'Administrador'
    : signer.role === 'procurador'
      ? 'Procurador'
      : 'Administrador';
  return {
    codigoInterno: '',
    tipoCadastro: 'Novo',
    tipoAssinante: tipo,
    nomeCompleto: signer.name,
    cpf: signer.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'),
    numeroDocumento: isRepresentative ? s(form.representanteRg) : s(administrator?.docIdentidade),
    assinaturaCartao: CLIENT_ANCHOR,
  };
}

async function loadTemplate(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.resolve(env.cedenteTemplatesPath, name)));
}

/** Fills the IndexCore PJ templates (ficha cadastral + one signature card per signer). */
export async function buildCedenteDocuments(form: Form): Promise<GeneratedCedenteDocument[]> {
  const signers = extractSigners(form);
  if (signers.length === 0) {
    throw new Error('Informe o representante legal antes de gerar os documentos');
  }

  const fichaTemplate = await loadTemplate('ficha-cadastral-pj.docx');
  const cartaoTemplate = await loadTemplate('cartao-assinatura.docx');

  const docs: GeneratedCedenteDocument[] = [
    {
      slot: 'ficha-cadastral-pj',
      type: 'ficha_cadastral_pj',
      title: 'Ficha Cadastral PJ',
      fileBaseName: 'ficha-cadastral-pj',
      docx: fillDocx(fichaTemplate, fichaCadastralValues(form)),
      signers: [
        { signer: signers[0]!, anchor: CLIENT_ANCHOR },
        { signer: 'index', anchor: INDEX_ANCHOR },
      ],
    },
  ];

  signers.forEach((signer, index) => {
    docs.push({
      slot: `${signer.key}-cartao-assinatura`,
      type: 'cartao_assinatura',
      title: `Cartão de Assinatura — ${signer.name}`,
      fileBaseName: `cartao-assinatura-${String(index + 1).padStart(2, '0')}`,
      docx: fillDocx(cartaoTemplate, cartaoAssinaturaValues(signer, form)),
      signers: [{ signer, anchor: CLIENT_ANCHOR }],
    });
  });

  return docs;
}
