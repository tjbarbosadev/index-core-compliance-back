import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { env } from '../env.js';

/** Erro de armazenamento Mega; `status` mapeia direto para HTTP (503 não configurado, 502 falha upstream). */
export class MegaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MegaError';
  }
}

const execFileAsync = promisify(execFile);
const HANDLE_RE = /\b(H:[A-Za-z0-9_-]+)\b/;
const TEMP_PREFIX = 'opcore-mega-';
/** Sessão MEGAcmd perdida / expirada — força novo login no próximo ensureMegaLogin. */
const SESSION_LOST_RE =
  /not logged|login required|please log|session.*expir|not authenticated|unauthori[sz]ed/i;
/** Nó/arquivo remoto inexistente (mega-rm / ls / get). */
const NODE_NOT_FOUND_RE =
  /no such file|doesn't exist|does not exist|couldn't find|could not find|not found|unknown (file|node|handle)|invalid (file|node|handle)/i;

let loginPromise: Promise<void> | null = null;

/** @internal testes — limpa cache de login. */
export function resetMegaLoginCache(): void {
  loginPromise = null;
}

export function parseMegaLsHandle(listing: string, fileName: string): string | null {
  const lines = listing.split('\n');
  for (const line of lines) {
    if (!line.includes(fileName)) continue;
    const match = HANDLE_RE.exec(line);
    if (match) return match[1];
  }
  return null;
}

function megaCommand(bin: string, args: string[]): { file: string; args: string[] } {
  const command = `mega-${bin}`;
  if (env.megacmdContainer) {
    return { file: 'docker', args: ['exec', env.megacmdContainer, command, ...args] };
  }
  return { file: command, args };
}

function isBinaryMissing(error: unknown, detail: string): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return true;
  return /mega-\w+[^\n]*not found|ENOENT/i.test(detail) && !NODE_NOT_FOUND_RE.test(detail);
}

function isNodeNotFoundDetail(detail: string): boolean {
  return NODE_NOT_FOUND_RE.test(detail);
}

async function runMega(bin: string, args: string[], timeout = 180000): Promise<string> {
  const command = megaCommand(bin, args);
  try {
    const { stdout, stderr } = await execFileAsync(command.file, command.args, {
      timeout,
      maxBuffer: 10_000_000,
      env: process.env,
    });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string; code?: string };
    const detail = (err.stderr || err.stdout || err.message || 'MEGAcmd failed').trim();

    if (bin !== 'whoami' && SESSION_LOST_RE.test(detail)) {
      loginPromise = null;
    }

    if (isBinaryMissing(error, detail)) {
      throw new MegaError(503, 'MEGAcmd não está disponível neste ambiente');
    }

    // Preserve stderr snippet so callers (megaRm) can detect node-not-found.
    const snippet = detail.replace(/\s+/g, ' ').slice(0, 240);
    throw new MegaError(502, snippet || 'Falha ao falar com o MEGAcmd');
  }
}

async function runLogin(): Promise<void> {
  try {
    const who = await runMega('whoami', []);
    if (who && !/not logged/i.test(who)) return;
  } catch {
    // session missing
  }

  if (!env.megaEmail || !env.megaPassword) {
    throw new MegaError(503, 'Armazenamento de documentos não configurado');
  }

  try {
    if (env.megacmdContainer) {
      await execFileAsync(
        'docker',
        [
          'exec',
          '-e',
          `MEGA_EMAIL=${env.megaEmail}`,
          '-e',
          `MEGA_PASSWORD=${env.megaPassword}`,
          env.megacmdContainer,
          'bash',
          '-lc',
          'mega-login "$MEGA_EMAIL" "$MEGA_PASSWORD"',
        ],
        { timeout: 180000, maxBuffer: 10_000_000 },
      );
      return;
    }
    await execFileAsync('mega-login', [env.megaEmail, env.megaPassword], {
      timeout: 180000,
      maxBuffer: 10_000_000,
    });
  } catch {
    throw new MegaError(502, 'Não foi possível conectar ao armazenamento Mega');
  }
}

export async function ensureMegaLogin(): Promise<void> {
  if (!loginPromise) {
    loginPromise = runLogin().catch((error) => {
      loginPromise = null;
      throw error;
    });
  }
  await loginPromise;
}

async function withUploadFile(
  fileName: string,
  buffer: Buffer,
  run: (localPath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const localPath = join(dir, fileName);
  const remoteDir = `/tmp/${TEMP_PREFIX}${randomUUID()}`;
  const remoteTmp = `${remoteDir}/${fileName}`;
  try {
    await writeFile(localPath, buffer);
    if (env.megacmdContainer) {
      try {
        await execFileAsync('docker', ['exec', env.megacmdContainer, 'mkdir', '-p', remoteDir]);
        await execFileAsync('docker', ['cp', localPath, `${env.megacmdContainer}:${remoteTmp}`]);
        await run(remoteTmp);
      } finally {
        await execFileAsync('docker', ['exec', env.megacmdContainer, 'rm', '-rf', remoteDir]).catch(
          () => undefined,
        );
      }
      return;
    }
    await run(localPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function megaMkdir(path: string): Promise<void> {
  await ensureMegaLogin();
  try {
    await runMega('mkdir', ['-p', path]);
  } catch (error) {
    if (!(error instanceof MegaError)) throw error;
    try {
      await runMega('ls', [path]);
    } catch {
      throw error;
    }
  }
}

export async function megaPut(localPath: string, destDir: string): Promise<void> {
  await ensureMegaLogin();
  await runMega('put', ['-c', localPath, destDir]);
}

export async function megaLs(path: string): Promise<string> {
  await ensureMegaLogin();
  return runMega('ls', ['-l', '--show-handles', path]);
}

export async function megaRm(handle: string): Promise<void> {
  await ensureMegaLogin();
  try {
    await runMega('rm', ['-r', '-f', handle]);
  } catch (error) {
    if (error instanceof MegaError && error.status === 502 && isNodeNotFoundDetail(error.message)) {
      return;
    }
    throw error;
  }
}

export async function uploadBufferWithMegacmd(input: {
  buffer: Buffer;
  fileName: string;
  destDir: string;
}): Promise<{ id: string; name: string }> {
  await megaMkdir(input.destDir);
  await withUploadFile(input.fileName, input.buffer, (localPath) =>
    megaPut(localPath, input.destDir),
  );
  const listing = await megaLs(input.destDir);
  const id = parseMegaLsHandle(listing, input.fileName);
  if (!id) {
    throw new MegaError(502, 'Resposta inválida do armazenamento Mega');
  }
  return { id, name: input.fileName };
}

/**
 * Downloads a Mega node by handle (`H:...`) into a temp directory and returns the bytes.
 */
export async function downloadBufferWithMegacmd(megaId: string): Promise<Buffer> {
  await ensureMegaLogin();
  const dir = await mkdtemp(join(tmpdir(), `${TEMP_PREFIX}dl-`));
  try {
    if (env.megacmdContainer) {
      const remoteDir = `/tmp/${TEMP_PREFIX}dl-${randomUUID()}`;
      await execFileAsync('docker', ['exec', env.megacmdContainer, 'mkdir', '-p', remoteDir]);
      try {
        await runMega('get', [megaId, remoteDir]);
        const listing = await execFileAsync('docker', [
          'exec',
          env.megacmdContainer,
          'ls',
          '-1',
          remoteDir,
        ]);
        const name = listing.stdout.trim().split('\n').filter(Boolean)[0];
        if (!name) {
          throw new MegaError(502, 'Arquivo não encontrado no Mega após download');
        }
        const remotePath = `${remoteDir}/${name}`;
        const localPath = join(dir, name);
        await execFileAsync('docker', ['cp', `${env.megacmdContainer}:${remotePath}`, localPath]);
        return await readFile(localPath);
      } finally {
        await execFileAsync('docker', ['exec', env.megacmdContainer, 'rm', '-rf', remoteDir]).catch(
          () => undefined,
        );
      }
    }

    await runMega('get', [megaId, dir]);
    const names = await readdir(dir);
    const name = names[0];
    if (!name) {
      throw new MegaError(502, 'Arquivo não encontrado no Mega após download');
    }
    return await readFile(join(dir, name));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
