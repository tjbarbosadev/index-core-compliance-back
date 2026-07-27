import { backfillAllActiveYields } from '../src/services/cotista-yield.service.js';
import { prisma } from '../src/db/index.js';

async function main() {
  const n = await backfillAllActiveYields();
  console.log(`Backfill concluído: ${n} registros processados`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
