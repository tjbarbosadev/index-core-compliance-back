import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Carrega `.env` (oficial / servidor) e, em development, sobrescreve com
 * `.env.development` (localhost). Variáveis já definidas no processo
 * (ex.: `docker --env-file`) não são sobrescritas pelo primeiro load;
 * o arquivo de development usa `override: true` de propósito.
 */
export function loadEnv(cwd = process.cwd()): void {
  const base = resolve(cwd, '.env');
  if (existsSync(base)) {
    config({ path: base });
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development') return;

  const development = resolve(cwd, '.env.development');
  if (existsSync(development)) {
    config({ path: development, override: true });
  }
}

loadEnv();
