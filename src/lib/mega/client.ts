import { env } from '../env.js';
import { downloadBufferWithMegacmd, MegaError, megaRm, uploadBufferWithMegacmd } from './cmd.js';
import { megaFilePath, megaRemoteDir, MEGA_SYSTEM, partnerDocsFolder } from './folder.js';

export { MegaError } from './cmd.js';

export type MegaUploadResult = {
  id: string;
  path: string;
  name: string;
};

export type UploadPartnerFileInput = {
  buffer: Buffer;
  /** Já no formato `{fileId}__{safeName}`. */
  fileName: string;
  mimeType: string;
  partnerId: string;
  /** CPF/CNPJ (dígitos). */
  document: string;
};

function vaultConfigured(): boolean {
  return Boolean(env.megaVaultUrl && env.megaVaultApiKey);
}

function accountConfigured(): boolean {
  return Boolean(env.megaEmail && env.megaPassword);
}

/** True se conta MEGAcmd ou vault HTTP estiver configurado. */
export function megaConfigured(): boolean {
  return vaultConfigured() || accountConfigured();
}

function ensureConfigured(): void {
  if (!megaConfigured()) {
    throw new MegaError(503, 'Armazenamento de documentos não configurado');
  }
}

/** Falhas inesperadas do MEGAcmd/docker/fs viram 502; MegaError passa intacto. */
async function wrapCmd<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MegaError) throw error;
    throw new MegaError(502, 'Falha ao falar com o MEGAcmd');
  }
}

async function parseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message || body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function uploadPartnerFile(input: UploadPartnerFileInput): Promise<MegaUploadResult> {
  ensureConfigured();
  const folder = partnerDocsFolder(input.partnerId, input.document);

  if (accountConfigured()) {
    return wrapCmd(async () => {
      const file = await uploadBufferWithMegacmd({
        buffer: input.buffer,
        fileName: input.fileName,
        destDir: megaRemoteDir(folder),
      });
      return {
        id: file.id,
        path: megaFilePath(folder, input.fileName),
        name: file.name,
      };
    });
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
    input.fileName,
  );
  form.append('system', MEGA_SYSTEM);
  form.append('folder', folder);

  let response: Response;
  try {
    response = await fetch(`${env.megaVaultUrl}/v1/files`, {
      method: 'POST',
      headers: { 'X-Api-Key': env.megaVaultApiKey },
      body: form,
    });
  } catch {
    throw new MegaError(502, 'Não foi possível conectar ao armazenamento Mega');
  }

  if (!response.ok) {
    throw new MegaError(502, await parseError(response, 'Falha ao enviar arquivo ao Mega'));
  }

  let payload: Partial<MegaUploadResult>;
  try {
    payload = (await response.json()) as Partial<MegaUploadResult>;
  } catch {
    throw new MegaError(502, 'Resposta inválida do armazenamento Mega');
  }
  if (!payload.id || !payload.path) {
    throw new MegaError(502, 'Resposta inválida do armazenamento Mega');
  }

  return { id: payload.id, path: payload.path, name: payload.name ?? input.fileName };
}

export async function downloadPartnerFile(megaId: string): Promise<Buffer> {
  ensureConfigured();

  if (accountConfigured()) {
    return wrapCmd(() => downloadBufferWithMegacmd(megaId));
  }

  throw new MegaError(
    501,
    'Download de documentos exige MEGAcmd (MEGA_EMAIL/MEGA_PASSWORD). Vault ainda não expõe content.',
  );
}

export async function deletePartnerFile(megaId: string): Promise<void> {
  ensureConfigured();

  if (accountConfigured()) {
    await wrapCmd(() => megaRm(megaId));
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${env.megaVaultUrl}/v1/files/${encodeURIComponent(megaId)}`, {
      method: 'DELETE',
      headers: { 'X-Api-Key': env.megaVaultApiKey },
    });
  } catch {
    throw new MegaError(502, 'Não foi possível conectar ao armazenamento Mega');
  }

  if (!response.ok && response.status !== 404) {
    throw new MegaError(502, await parseError(response, 'Falha ao remover arquivo do Mega'));
  }
}
