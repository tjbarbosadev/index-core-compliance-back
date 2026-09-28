import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cedenteFormFixture } from '../cedente-form.fixture.js';
import { extractSigners } from '../document-catalog.js';
import {
  CLIENT_ANCHOR,
  INDEX_ANCHOR,
  cartaoAssinaturaValues,
  fichaCadastralValues,
  localDataTexto,
} from './cedente-documents.js';
import { docxPlainText, fillDocx } from './docx-filler.js';

const TEMPLATES = path.resolve(__dirname, '../../../../assets/templates/cedente');

function docx(bodyXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="w"><w:body>${bodyXml}</w:body></w:document>`,
    ),
  });
}

describe('fillDocx', () => {
  it('replaces placeholders split across several runs', () => {
    const template = docx(
      '<w:p><w:r><w:t>Razão: &lt;&lt;razao</w:t></w:r><w:r><w:t xml:space="preserve">Social&gt;&gt; fim</w:t></w:r></w:p>',
    );
    const out = fillDocx(template, { razaoSocial: 'ACME LTDA' });
    expect(docxPlainText(out)).toBe('Razão: ACME LTDA fim');
  });

  it('escapes XML and clears unmapped placeholders', () => {
    const template = docx('<w:p><w:r><w:t>&lt;&lt;a&gt;&gt;|&lt;&lt;b&gt;&gt;</w:t></w:r></w:p>');
    const out = fillDocx(template, { a: 'R&D <x>' });
    expect(docxPlainText(out)).toBe('R&amp;D &lt;x&gt;|');
  });

  it('leaves paragraphs without placeholders untouched', () => {
    const template = docx('<w:p><w:r><w:t>Sem campos</w:t></w:r></w:p>');
    expect(docxPlainText(fillDocx(template, { x: 'y' }))).toBe('Sem campos');
  });
});

describe('IndexCore PJ templates', () => {
  const now = new Date(2026, 8, 28);

  it('fills the ficha cadastral and keeps both ZapSign anchors', () => {
    const template = new Uint8Array(readFileSync(path.join(TEMPLATES, 'ficha-cadastral-pj.docx')));
    const text = docxPlainText(fillDocx(template, fichaCadastralValues(cedenteFormFixture, now)));
    expect(text).toContain('Cedente Teste LTDA');
    expect(text).toContain('11222333000181');
    expect(text).toContain('Administrador Adicional');
    expect(text).toContain(CLIENT_ANCHOR);
    expect(text).toContain(INDEX_ANCHOR);
    expect(text).not.toMatch(/&lt;&lt;\w+&gt;&gt;/);
  });

  it('fills one signature card per signer with the client anchor', () => {
    const template = new Uint8Array(readFileSync(path.join(TEMPLATES, 'cartao-assinatura.docx')));
    const [representative, administrator] = extractSigners(cedenteFormFixture);

    const repText = docxPlainText(
      fillDocx(template, cartaoAssinaturaValues(representative!, cedenteFormFixture)),
    );
    expect(repText).toContain('Representante Legal');
    expect(repText).toContain('529.982.247-25');
    expect(repText).toContain('123456789');
    expect(repText).toContain(CLIENT_ANCHOR);
    expect(repText).not.toMatch(/&lt;&lt;\w+&gt;&gt;/);

    const adminValues = cartaoAssinaturaValues(administrator!, cedenteFormFixture);
    expect(adminValues.numeroDocumento).toBe('987654321');
    expect(adminValues.tipoAssinante).toBe('Administrador');
  });

  it('maps yes/no and enum fields to readable text', () => {
    const values = fichaCadastralValues(cedenteFormFixture, now);
    expect(values.tipoConstituicao).toBe('LTDA');
    expect(values.regimeTributario).toBe('Tributado');
    expect(values.domiciliadoExterior).toBe('Não');
    expect(values.agencia1).toBe('0001 - Agência Centro');
    expect(values.contaCorrente1).toBe('123456-7');
    expect(values.localData).toBe('Barueri, 28 de setembro de 2026');
  });

  it('formats the date line without a city', () => {
    expect(localDataTexto(undefined, now)).toBe('28 de setembro de 2026');
  });
});
