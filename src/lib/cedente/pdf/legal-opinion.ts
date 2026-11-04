export type LegalOpinionInput = {
  legalName: string;
  cnpj: string;
  partyType?: 'pf' | 'pj';
  decision: 'favoravel' | 'pendencia' | 'desfavoravel';
  opinion: string;
  pendingItems: string[];
  reviewerName: string;
  reviewerEmail: string;
  reviewedAt: Date;
  documents: Array<{ label: string; status: string }>;
};

const DECISION_LABEL: Record<LegalOpinionInput['decision'], string> = {
  favoravel: 'Favorável',
  pendencia: 'Pendência',
  desfavoravel: 'Desfavorável',
};

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  expirado: 'Expirado',
};

function formatDocument(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export async function buildLegalOpinionPdf(input: LegalOpinionInput): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      info: { Title: `Parecer jurídico — ${input.legalName}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#0f766e').text('IndexCore — Parecer jurídico');
    doc.moveDown(0.3);
    const pf = input.partyType === 'pf' || input.cnpj.replace(/\D/g, '').length === 11;
    doc.fontSize(10).fillColor('#374151');
    doc.text(
      pf ? 'Onboarding de cedente (Pessoa Física)' : 'Onboarding de cedente (Pessoa Jurídica)',
    );
    doc.moveDown();

    const kv = (label: string, value: string) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    };
    kv(pf ? 'Nome' : 'Razão social', input.legalName);
    kv(pf ? 'CPF' : 'CNPJ', formatDocument(input.cnpj));
    kv('Decisão', DECISION_LABEL[input.decision]);
    kv('Responsável', `${input.reviewerName} <${input.reviewerEmail}>`);
    kv('Data', input.reviewedAt.toISOString());

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Parecer');
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#374151')
      .text(input.opinion, { align: 'justify' });

    if (input.pendingItems.length > 0) {
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Pendências');
      doc.font('Helvetica').fontSize(10).fillColor('#374151');
      for (const item of input.pendingItems) doc.text(`• ${item}`);
    }

    if (input.documents.length > 0) {
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Documentos analisados');
      doc.font('Helvetica').fontSize(10).fillColor('#374151');
      for (const d of input.documents) {
        doc.text(`• ${d.label} — ${STATUS_LABEL[d.status] ?? d.status}`);
      }
    }

    doc.end();
  });
}
