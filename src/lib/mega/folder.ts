/** Vault `system` e raiz MEGAcmd para documentos do OpCore. */
export const MEGA_SYSTEM = 'opcore';
export const PARTNER_DOCS_ROOT = 'partner-docs';

const SAFE_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

export function sanitizeFileName(value: string): string {
  const ascii = value.normalize('NFD').replace(/\p{M}/gu, '').trim();
  const safe = ascii
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._]+|_+$/g, '')
    .slice(0, 120);
  return safe || 'arquivo';
}

/** Folder lógico (vault `folder`): `partner-docs/{partnerId}/{cpfCnpj}`. */
export function partnerDocsFolder(partnerId: string, document: string): string {
  const digits = document.replace(/\D/g, '');
  if (!SAFE_SEGMENT_RE.test(partnerId)) {
    throw new Error('partnerId inválido para pasta Mega');
  }
  if (!digits) {
    throw new Error('Documento (CPF/CNPJ) inválido para pasta Mega');
  }
  return `${PARTNER_DOCS_ROOT}/${partnerId}/${digits}`;
}

/** Diretório remoto MEGAcmd: `/opcore/partner-docs/{partnerId}/{cpfCnpj}`. */
export function megaRemoteDir(folder: string): string {
  return `/${MEGA_SYSTEM}/${folder}`;
}

export function megaFilePath(folder: string, fileName: string): string {
  return `${megaRemoteDir(folder)}/${fileName}`;
}
