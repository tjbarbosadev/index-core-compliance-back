/**
 * One-shot: run daily scheduled jobs (expirations + yields).
 * Usage: npm run job:daily
 */
import '../src/lib/load-env.js';
import { runDailyJobs } from '../src/lib/scheduler.js';
import { prisma } from '../src/db/index.js';

runDailyJobs()
  .then(() => {
    console.log('job:daily OK');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
