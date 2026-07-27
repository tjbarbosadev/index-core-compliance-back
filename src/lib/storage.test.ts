import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
  envMock: { storagePath: '' },
}));

vi.mock('./env.js', () => ({
  env: envMock,
}));

import {
  buildObjectKey,
  fileExists,
  fileUriForKey,
  getAbsolutePath,
  keyFromFileUri,
  saveFile,
} from './storage.js';

describe('storage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opcore-storage-'));
    envMock.storagePath = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('builds object key from party, type and document id', () => {
    expect(buildObjectKey('party-1', 'rg', 'doc-1')).toBe('party-1/rg/doc-1');
  });

  it('round-trips local file URI', () => {
    const key = 'party-1/rg/doc-1';
    expect(keyFromFileUri(fileUriForKey(key))).toBe(key);
  });

  it('parses legacy s3 URI', () => {
    expect(keyFromFileUri('s3://bucket/party-1/rg/doc-1')).toBe('party-1/rg/doc-1');
  });

  it('saves and checks file existence', async () => {
    const key = 'party-1/rg/doc-1';
    expect(await fileExists(key)).toBe(false);
    await saveFile(key, Buffer.from('conteudo'));
    expect(await fileExists(key)).toBe(true);
  });

  it('rejects path traversal in key', () => {
    expect(() => getAbsolutePath('../etc/passwd')).toThrow('Chave de arquivo inválida');
    expect(() => getAbsolutePath('party/../secret')).toThrow('Chave de arquivo inválida');
  });
});
