import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.js';

export function buildObjectKey(partyId: string, type: string, documentId: string): string {
  return `${partyId}/${type}/${documentId}`;
}

export function fileUriForKey(key: string): string {
  return `local://${key}`;
}

export function keyFromFileUri(uri: string): string {
  if (uri.startsWith('local://')) {
    return uri.slice('local://'.length);
  }
  if (uri.startsWith('s3://')) {
    return uri.replace(/^s3:\/\/[^/]+\//, '');
  }
  throw new Error('URI de arquivo inválida');
}

function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || path.isAbsolute(key)) {
    throw new Error('Chave de arquivo inválida');
  }
}

export function getAbsolutePath(key: string): string {
  assertSafeKey(key);
  const base = path.resolve(env.storagePath);
  const resolved = path.resolve(base, key);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('Chave de arquivo inválida');
  }
  return resolved;
}

export async function saveFile(key: string, data: Buffer): Promise<void> {
  const absolutePath = getAbsolutePath(key);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, data);
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    await fs.access(getAbsolutePath(key));
    return true;
  } catch {
    return false;
  }
}
