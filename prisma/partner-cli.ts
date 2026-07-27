/**
 * CLI: criar / rotacionar tokens de parceiros externos.
 *
 *   npm run partner:create -- --name=acme --email=ops@acme.com --rpm=60
 *   npm run partner:rotate -- --id=<uuid>
 */
import { createApiPartner, rotatePartnerToken } from '../src/services/partner.service.js';
import { prisma } from '../src/db/index.js';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a: string) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'create') {
    const name = arg('name');
    const email = arg('email');
    if (!name) throw new Error('Use --name=parceiro');
    if (!email) throw new Error('Use --email=ops@parceiro.com');
    const rpm = Number(arg('rpm') ?? 120);
    const result = await createApiPartner({ name, email, rateLimitRpm: rpm });
    console.log(JSON.stringify(result, null, 2));
    console.log('\nGuarde o token — ele não será exibido novamente.');
    if (!result.emailSent) {
      console.log('E-mail não enviado (configure RESEND_API_KEY).');
    }
    return;
  }

  if (cmd === 'rotate') {
    const id = arg('id');
    if (!id) throw new Error('Use --id=<uuid>');
    const result = await rotatePartnerToken(id);
    console.log(JSON.stringify({ partnerId: id, ...result }, null, 2));
    console.log('\nToken anterior permanece válido pelo grace period configurado.');
    if (!result.emailSent) {
      console.log('E-mail não enviado (configure RESEND_API_KEY).');
    }
    return;
  }

  if (cmd === 'list') {
    const rows = await prisma.apiPartner.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        rateLimitRpm: true,
        rotatedAt: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(`Uso:
  npx tsx prisma/partner-cli.ts create --name=acme --email=ops@acme.com --rpm=60
  npx tsx prisma/partner-cli.ts rotate --id=<uuid>
  npx tsx prisma/partner-cli.ts list`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
