import { execSync } from 'node:child_process';
import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://opcore:opcore@localhost:5433/opcore_test';

/**
 * Creates the throwaway test database (name must end in `_test`) and syncs it to the current
 * schema. `db push` instead of `migrate deploy`: the migration history starts from a pushed
 * baseline and cannot build an empty database. Tests truncate the tables they use.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const database = url.pathname.slice(1);
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against "${database}" (must end in _test)`);
  }

  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.end();
  }

  execSync('npx prisma db push', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test' },
  });
}
