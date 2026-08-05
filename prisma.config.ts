// Não importa de `src/`: o Docker roda `prisma generate` (postinstall) antes de
// copiar `src`, e a imagem final não inclui `src`.
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

if (existsSync('.env')) config({ path: '.env' });
if ((process.env.NODE_ENV ?? 'development') === 'development' && existsSync('.env.development')) {
  config({ path: '.env.development', override: true });
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
