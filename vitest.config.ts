import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Prisma client is created at import time; CI runners have no .env.
process.env.DATABASE_URL ??= 'postgresql://opcore:opcore@127.0.0.1:5432/opcore';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
});
