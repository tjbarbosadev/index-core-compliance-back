import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './src/test/integration-setup';

// Real Postgres (throwaway `*_test` database); external services are mocked per test file.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./src/test/integration-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      STORAGE_PATH: path.join(os.tmpdir(), 'opcore-integration-storage'),
      ZAPSIGN_API_TOKEN: 'integration-token',
      ZAPSIGN_SANDBOX: 'true',
      ZAPSIGN_SANDBOX_SIGNER_EMAIL: 'qa@example.com',
      ZAPSIGN_INDEX_SIGNER_EMAIL: 'index@example.com',
      IPEBANK_OFFICIAL_EMAIL: '',
    },
  },
});
