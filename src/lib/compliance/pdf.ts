import type { ComplianceDossier } from './types.js';

const LABEL_MAP: Record<string, string> = {
  cadastral: 'Cadastral',
  pldft: 'PLD/FT e sanções',
  litigation: 'Litígios',
  financial: 'Financeiro',
  credit: 'Crédito',
  esg: 'ESG',
  corporateLinks: 'Vínculos societários',
  corporateStructure: 'Estrutura societária',
  sanctions: 'Sanções',
  fiscalHealth: 'Saúde fiscal',
  fullName: 'Nome completo',
  legalName: 'Razão social',
  tradeName: 'Nome fantasia',
  cnpjStatus: 'Status do CNPJ',
  cpfStatus: 'Status do CPF',
  cnae: 'CNAE',
  cnaeDescription: 'Descrição do CNAE',
  capital: 'Capital social',
  taxRegime: 'Regime tributário',
  companyType: 'Tipo societário',
  legalNature: 'Natureza jurídica',
  openingDate: 'Data de abertura',
  headquarterState: 'UF da sede',
  activities: 'Atividades',
  phones: 'Telefones',
  emails: 'E-mails',
  addresses: 'Endereços',
  isPep: 'PEP',
  isCurrentlyPep: 'PEP atual',
  isCurrentlySanctioned: 'Sancionado atualmente',
  isCurrentlySanctionedBdcRaw: 'Sancionado (bureau)',
  wasPreviouslySanctioned: 'Já foi sancionado',
  internationalHits: 'Ocorrências internacionais',
  internationalHitsSummary: 'Resumo de ocorrências internacionais',
  collectionsPresence: 'Presença em cobrança',
  registrationData: 'Dados de registro',
  federalDebt: 'Dívida federal',
  qsa: 'Quadro societário',
  Emails: 'E-mails',
  Phones: 'Telefones',
  Addresses: 'Endereços',
  BasicData: 'Dados básicos',
  Primary: 'Principal',
  Type: 'Tipo',
  EmailAddress: 'E-mail',
  LastUpdateDate: 'Última atualização',
  Number: 'Número',
  AreaCode: 'DDD',
  CountryCode: 'DDI',
  City: 'Cidade',
  State: 'UF',
  Country: 'País',
  ZipCode: 'CEP',
  AddressMain: 'Logradouro',
  Neighborhood: 'Bairro',
  Complement: 'Complemento',
  OfficialName: 'Nome oficial',
  TaxIdNumber: 'CNPJ/CPF',
  TaxIdStatus: 'Status cadastral',
  FoundedDate: 'Data de fundação',
  LegalNature: 'Natureza jurídica',
  IsHeadquarter: 'Matriz',
  AdditionalOutputData: 'Dados adicionais',
  Capital: 'Capital (extenso)',
  CapitalRS: 'Capital (R$)',
  Activities: 'Atividades',
  Code: 'Código',
  IsMain: 'Principal',
  Activity: 'Atividade',
  IsCurrentlyOnCollection: 'Em cobrança atualmente',
  TotalCollectionOccurrences: 'Ocorrências de cobrança',
  TotalDebts: 'Qtd. dívidas',
  TotalDebtValue: 'Valor total das dívidas',
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
  muito_alto: 'Muito alto',
  rejeitado: 'Rejeitado',
  revisao_manual: 'Revisão manual',
  ATIVA: 'Ativa',
  REGULAR: 'Regular',
  pep: 'PEP',
  lista_restritiva: 'Lista restritiva',
  pj_sanctioned: 'Empresa sancionada',
  collections_presence: 'Presença em cobrança',
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  critica: 'Crítica',
};

const RISK_LABEL: Record<string, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
  muito_alto: 'Muito alto',
};

function labelOf(key: string): string {
  if (LABEL_MAP[key]) return LABEL_MAP[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function subjectName(dossier: ComplianceDossier): string {
  const s = dossier.subject;
  if (s.type === 'PF') return s.fullName ?? '—';
  return s.legalName ?? s.tradeName ?? '—';
}

function formatDoc(document: string, documentType: string): string {
  const d = document.replace(/\D/g, '');
  if (documentType === 'CPF' && d.length === 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (documentType === 'CNPJ' && d.length === 14) {
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return document;
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (LABEL_MAP[value]) return LABEL_MAP[value];
    if (value.startsWith('9999-12-31') || value.startsWith('0001-01-01')) return '—';
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const t = Date.parse(value);
      if (!Number.isNaN(t)) return new Date(value).toLocaleDateString('pt-BR');
    }
    return value;
  }
  return String(value);
}

function addSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.8);
  doc.fontSize(13).fillColor('#0f766e').text(title);
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#111827');
}

function addKeyValue(doc: PDFKit.PDFDocument, label: string, value: string) {
  if (!value || value === '—') return;
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value);
}

function renderValue(doc: PDFKit.PDFDocument, value: unknown, indent = 0): void {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) {
    doc.text(`${pad}—`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      doc.text(`${pad}Nenhum`);
      return;
    }
    value.forEach((item, index) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        doc.font('Helvetica-Bold').text(`${pad}Item ${index + 1}`);
        renderObjectFields(doc, item as Record<string, unknown>, indent + 1);
      } else {
        doc.font('Helvetica').text(`${pad}• ${formatPrimitive(item)}`);
      }
    });
    return;
  }
  if (typeof value === 'object') {
    renderObjectFields(doc, value as Record<string, unknown>, indent);
    return;
  }
  doc.font('Helvetica').text(`${pad}${formatPrimitive(value)}`);
}

function renderObjectFields(
  doc: PDFKit.PDFDocument,
  obj: Record<string, unknown> | undefined,
  indent = 0,
) {
  if (!obj || typeof obj !== 'object') {
    doc.text('Sem dados.');
    return;
  }
  const pad = '  '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    const label = labelOf(key);
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      doc.font('Helvetica-Bold').text(`${pad}${label}:`);
      renderValue(doc, value, indent + 1);
      continue;
    }
    doc.font('Helvetica-Bold').text(`${pad}${label}: `, { continued: true });
    doc.font('Helvetica').text(formatPrimitive(value));
  }
}

export async function buildKycReportPdf(dossier: ComplianceDossier): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      info: { Title: 'Relatório KYC IndexCore' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#0f766e').text('IndexCore — Relatório KYC/KYB');
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#374151');
    doc.text(
      `Documento: ${formatDoc(dossier.meta.document, dossier.meta.documentType)} (${dossier.meta.documentType})`,
    );
    doc.text(`Sujeito: ${subjectName(dossier)}`);
    doc.text(`Gerado em: ${dossier.meta.generatedAt}`);
    doc.text(`Hash: ${dossier.audit.reportHash || dossier.meta.hash}`);
    doc.text(`Completude: ${Math.round((dossier.meta.completeness ?? 0) * 100)}%`);

    addSectionTitle(doc, 'Veredito de risco');
    addKeyValue(doc, 'Nível', RISK_LABEL[dossier.risk.level] ?? dossier.risk.level);
    addKeyValue(doc, 'Score', String(dossier.risk.score));
    addKeyValue(doc, 'Status', labelOf(dossier.risk.complianceStatus ?? dossier.compliance.status));
    addKeyValue(
      doc,
      'Bloqueado',
      dossier.risk.blocked || dossier.compliance.blocked ? 'Sim' : 'Não',
    );
    addKeyValue(doc, 'Revisão manual', dossier.risk.requiresManualReview ? 'Sim' : 'Não');
    if (dossier.risk.recommendation) {
      addKeyValue(doc, 'Recomendação', dossier.risk.recommendation);
    }

    if (dossier.risk.factors?.length) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Fatores:');
      doc.font('Helvetica');
      for (const factor of dossier.risk.factors) {
        doc.text(
          `• [${labelOf(factor.severity)}] ${labelOf(factor.code)}: ${factor.description} (peso ${factor.weight})`,
        );
      }
    }

    if (dossier.compliance.alerts?.length) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Alertas:');
      doc.font('Helvetica');
      for (const alert of dossier.compliance.alerts) {
        doc.text(`• ${labelOf(alert.type)} (${labelOf(alert.severity)})`);
      }
    }

    const sections = dossier.sections ?? {};
    const sectionOrder = [
      'cadastral',
      'pldft',
      'litigation',
      'financial',
      'credit',
      'esg',
      'corporateLinks',
      'corporateStructure',
      'sanctions',
      'fiscalHealth',
    ] as const;

    for (const key of sectionOrder) {
      const block = sections[key];
      if (!block) continue;
      addSectionTitle(doc, labelOf(key));
      renderObjectFields(doc, block as Record<string, unknown>);
    }

    for (const [key, block] of Object.entries(sections)) {
      if ((sectionOrder as readonly string[]).includes(key)) continue;
      addSectionTitle(doc, labelOf(key));
      renderObjectFields(doc, block as Record<string, unknown>);
    }

    addSectionTitle(doc, 'Fontes consultadas');
    if (!dossier.sources?.length) {
      doc.text('Nenhuma fonte registrada.');
    } else {
      for (const source of dossier.sources) {
        doc.text(
          `• ${source.providerSlug} — ${source.consultedAt}${source.cacheHit ? ' (cache)' : ''}`,
        );
      }
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#6b7280')
      .text('Documento gerado pelo OpCore Admin a partir da API OpCore Compliance. Uso interno.');

    doc.end();
  });
}
