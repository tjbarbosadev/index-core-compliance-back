import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const OPEN = '&lt;&lt;';
const PLACEHOLDER_RE = /&lt;&lt;([A-Za-z0-9_]+)&gt;&gt;/g;
const TEXT_NODE_RE = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Replaces `<<name>>` placeholders inside one paragraph. Word often splits a placeholder
 * across several `<w:t>` runs, so matching runs on the concatenated paragraph text.
 * Unmapped placeholders are cleared so no template syntax leaks into the PDF.
 */
function fillParagraph(paragraph: string, values: Record<string, string>): string {
  if (!paragraph.includes(OPEN)) return paragraph;

  const nodes: { text: string; start: number }[] = [];
  let concat = '';
  for (const match of paragraph.matchAll(TEXT_NODE_RE)) {
    nodes.push({ text: match[2]!, start: concat.length });
    concat += match[2];
  }
  if (!concat.includes(OPEN)) return paragraph;

  const replacements: { start: number; end: number; text: string }[] = [];
  for (const match of concat.matchAll(PLACEHOLDER_RE)) {
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      text: xmlEscape(values[match[1]!] ?? ''),
    });
  }
  if (replacements.length === 0) return paragraph;

  const covering = (i: number) => replacements.find((r) => r.start <= i && i < r.end);

  let nodeIndex = 0;
  return paragraph.replace(TEXT_NODE_RE, (_full, open: string, _text: string, close: string) => {
    const node = nodes[nodeIndex++]!;
    let out = '';
    for (let i = node.start; i < node.start + node.text.length; i++) {
      const r = covering(i);
      if (!r) out += concat[i];
      else if (i === r.start) out += r.text;
    }
    return open + out + close;
  });
}

function fillXml(xml: string, values: Record<string, string>): string {
  if (!xml.includes(OPEN)) return xml;
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (p) => fillParagraph(p, values));
}

export function fillDocx(templateBytes: Uint8Array, values: Record<string, string>): Uint8Array {
  const files = unzipSync(templateBytes);
  const out: Record<string, Uint8Array> = {};

  for (const [name, content] of Object.entries(files)) {
    const isWordXml =
      name.startsWith('word/') &&
      name.endsWith('.xml') &&
      (name.includes('document') || name.includes('header') || name.includes('footer'));
    out[name] = isWordXml ? strToU8(fillXml(strFromU8(content), values)) : content;
  }

  return zipSync(out, { level: 0 });
}

/** Visible text of `word/document.xml` (tests and diagnostics). */
export function docxPlainText(docxBytes: Uint8Array): string {
  const files = unzipSync(docxBytes);
  const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array());
  return [...xml.matchAll(TEXT_NODE_RE)].map((m) => m[2]).join('');
}
