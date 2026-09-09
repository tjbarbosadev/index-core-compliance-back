import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FundModality, AssetClass, type QuotaType } from '@prisma/client';
import { prisma } from '../src/db/index.js';
import { hashPassword } from '../src/services/auth.service.js';
import { mapDataJsonQuota, parseYYYYMMDD } from '../src/services/quota-calculator.js';
import { backfillAllActiveYields } from '../src/services/cotista-yield.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PERMISSIONS = [
  { key: 'dashboard.read', description: 'Ver dashboard', module: 'dashboard' },
  { key: 'fundos.read', description: 'Listar fundos', module: 'fundos' },
  { key: 'fundos.write', description: 'Criar e editar fundos', module: 'fundos' },
  { key: 'onboarding.read', description: 'Ver onboardings', module: 'onboarding' },
  { key: 'onboarding.write', description: 'Criar e avançar onboarding', module: 'onboarding' },
  { key: 'onboarding.approve', description: 'Aprovar/rejeitar onboarding', module: 'onboarding' },
  { key: 'cotistas.read', description: 'Listar cotistas', module: 'cotistas' },
  { key: 'cotistas.write', description: 'Editar cotistas', module: 'cotistas' },
  { key: 'cotistas.view_kyc', description: 'Ver dados KYC completos', module: 'cotistas' },
  { key: 'cotistas.approve', description: 'Aprovar/rejeitar cotista', module: 'cotistas' },
  { key: 'cedentes.read', description: 'Listar cedentes', module: 'cedentes' },
  { key: 'cedentes.write', description: 'Onboarding de cedentes', module: 'cedentes' },
  { key: 'cedentes.approve', description: 'Aprovar cedente', module: 'cedentes' },
  { key: 'documents.read', description: 'Listar documentos', module: 'documents' },
  { key: 'documents.write', description: 'Upload de documentos', module: 'documents' },
  { key: 'documents.view_kyc', description: 'Ver documentos KYC', module: 'documents' },
  { key: 'documents.approve', description: 'Validar documentos', module: 'documents' },
  { key: 'transactions.read', description: 'Listar transações', module: 'transactions' },
  { key: 'transactions.write', description: 'Criar transações', module: 'transactions' },
  {
    key: 'transactions.approve',
    description: 'Aprovar/estornar transações',
    module: 'transactions',
  },
  { key: 'compliance.read', description: 'Ver compliance e alertas', module: 'compliance' },
  { key: 'compliance.write', description: 'Gerenciar alertas COAF', module: 'compliance' },
  { key: 'compliance.investigate', description: 'Investigar alertas', module: 'compliance' },
  { key: 'regulatory.read', description: 'Ver calendário regulatório', module: 'regulatory' },
  {
    key: 'regulatory.approve',
    description: 'Aprovar submissões regulatórias',
    module: 'regulatory',
  },
  { key: 'audit.read', description: 'Consultar auditoria', module: 'audit' },
  { key: 'arquivo.read', description: 'Consultar arquivo de evidências', module: 'arquivo' },
  { key: 'admin.manage_access', description: 'Gerenciar usuários e permissões', module: 'admin' },
] as const;

/** Perfis de referência para seed (overrides por usuário — não há mais grupos). */
const PROFILE_PERMISSIONS: Record<string, string[]> = {
  Administrador: PERMISSIONS.map((p) => p.key),
  Compliance: [
    'dashboard.read',
    'fundos.read',
    'fundos.write',
    'onboarding.read',
    'onboarding.write',
    'onboarding.approve',
    'cotistas.read',
    'cotistas.write',
    'cotistas.view_kyc',
    'cotistas.approve',
    'cedentes.read',
    'cedentes.write',
    'cedentes.approve',
    'documents.read',
    'documents.write',
    'documents.view_kyc',
    'documents.approve',
    'compliance.read',
    'compliance.write',
    'compliance.investigate',
    'regulatory.read',
    'regulatory.approve',
    'audit.read',
    'arquivo.read',
  ],
  Gestão: [
    'dashboard.read',
    'fundos.read',
    'cotistas.read',
    'cedentes.read',
    'transactions.read',
    'transactions.write',
    'transactions.approve',
  ],
  Operacional: [
    'dashboard.read',
    'onboarding.read',
    'onboarding.write',
    'documents.read',
    'documents.write',
    'cotistas.read',
  ],
  Ouvidoria: ['dashboard.read', 'arquivo.read', 'audit.read', 'documents.read'],
  Fiduciária: ['dashboard.read', 'regulatory.read', 'regulatory.approve'],
};

const MENU_ITEMS = [
  {
    key: 'menu-dashboard',
    label: 'Dashboard',
    route: '/dashboard',
    icon: 'layout-dashboard',
    sortOrder: 10,
    perm: 'dashboard.read',
  },
  {
    key: 'menu-fundos',
    label: 'Fundos',
    route: '/fundos',
    icon: 'building',
    sortOrder: 20,
    perm: 'fundos.read',
  },
  {
    key: 'menu-onboarding',
    label: 'Onboarding',
    route: '/onboarding',
    icon: 'user-plus',
    sortOrder: 30,
    perm: 'onboarding.read',
  },
  {
    key: 'menu-cotistas',
    label: 'Cotistas',
    route: '/cotistas',
    icon: 'users',
    sortOrder: 40,
    perm: 'cotistas.read',
  },
  {
    key: 'menu-cedentes',
    label: 'Cedentes',
    route: '/cedentes',
    icon: 'briefcase',
    sortOrder: 50,
    perm: 'cedentes.read',
  },
  {
    key: 'menu-transacoes',
    label: 'Transações',
    route: '/transacoes',
    icon: 'arrow-left-right',
    sortOrder: 70,
    perm: 'transactions.read',
  },
  {
    key: 'menu-compliance',
    label: 'Compliance',
    route: '/compliance',
    icon: 'shield',
    sortOrder: 80,
    perm: 'compliance.read',
  },
  {
    key: 'menu-kyc',
    label: 'Dossiês KYC',
    route: '/kyc',
    icon: 'file-search',
    sortOrder: 85,
    perm: 'compliance.read',
  },
  {
    key: 'menu-calendario',
    label: 'Calendário',
    route: '/calendario',
    icon: 'calendar',
    sortOrder: 90,
    perm: 'regulatory.read',
  },
  {
    key: 'menu-auditoria',
    label: 'Auditoria',
    route: '/auditoria',
    icon: 'scroll-text',
    sortOrder: 110,
    perm: 'audit.read',
  },
  {
    key: 'menu-admin',
    label: 'Administração',
    route: '/admin',
    icon: 'settings',
    sortOrder: 120,
    perm: 'admin.manage_access',
  },
];

const SEED_DEFAULT_PASSWORD = 'Mudar@123';

const SEED_USERS = [
  {
    email: 'admin@indexcore.local',
    name: 'Administrador',
    profile: 'Administrador',
    isAdmin: true,
  },
  {
    email: 'thiago.barbosa@ipebank.com.br',
    name: 'Thiago Barbosa',
    profile: 'Administrador',
    isAdmin: true,
  },
  {
    email: 'compliance@indexcore.local',
    name: 'Compliance',
    profile: 'Compliance',
    isAdmin: false,
  },
  { email: 'gestao@indexcore.local', name: 'Gestão', profile: 'Gestão', isAdmin: false },
  {
    email: 'operacional@indexcore.local',
    name: 'Operacional',
    profile: 'Operacional',
    isAdmin: false,
  },
  { email: 'ouvidoria@indexcore.local', name: 'Ouvidoria', profile: 'Ouvidoria', isAdmin: false },
  {
    email: 'fiduciaria@indexcore.local',
    name: 'Fiduciária',
    profile: 'Fiduciária',
    isAdmin: false,
  },
];

type DataClient = {
  id: number;
  name: string;
  document: string;
  email: string;
  phone: string;
  investment: number;
  totalQuotas: number;
  initialDate: string;
  finalDate: string;
  quota: string;
};

function parseBrDate(d: string): Date {
  const [dd, mm, yyyy] = d.split('/');
  return parseYYYYMMDD(`${yyyy}-${mm}-${dd}`);
}

async function seedCotistasFromDataJson(fundId: string): Promise<number> {
  const dataPath = join(__dirname, 'data/clients.json');
  const raw = JSON.parse(readFileSync(dataPath, 'utf-8')) as { clients: DataClient[] };

  const byCpf = new Map<string, DataClient[]>();
  for (const client of raw.clients) {
    const cpf = client.document.replace(/\D/g, '');
    const list = byCpf.get(cpf) ?? [];
    list.push(client);
    byCpf.set(cpf, list);
  }

  for (const [cpf, rows] of byCpf) {
    const primary = rows[0]!;
    const party = await prisma.party.upsert({
      where: { cpfCnpj: cpf },
      update: {
        legalName: primary.name.trim(),
        status: 'aprovado',
        approvedAt: new Date(),
      },
      create: {
        type: 'pf',
        cpfCnpj: cpf,
        legalName: primary.name.trim(),
        status: 'aprovado',
        riskLevel: 'baixo',
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.partyContact.deleteMany({ where: { partyId: party.id } });
    await prisma.partyContact.create({
      data: {
        partyId: party.id,
        email: primary.email,
        phone: primary.phone,
        isPrimary: true,
      },
    });

    await prisma.cotista.upsert({
      where: { partyId: party.id },
      update: {},
      create: {
        partyId: party.id,
        investorProfile: 'conservador',
        suitabilityResult: 'conservador',
      },
    });

    // Recreate all positions for this party+fund from seed rows (idempotent).
    await prisma.partyFundLink.deleteMany({ where: { partyId: party.id, fundId } });
    for (const client of rows) {
      const quotaType = mapDataJsonQuota(client.quota) as QuotaType;
      await prisma.partyFundLink.create({
        data: {
          partyId: party.id,
          fundId,
          quotaType,
          quotaCount: client.totalQuotas,
          quotaAmount: client.investment,
          initialInvestment: client.investment,
          currentPrincipal: client.investment,
          contractStartDate: parseBrDate(client.initialDate),
          contractEndDate: parseBrDate(client.finalDate),
        },
      });
    }
  }

  return byCpf.size;
}

async function main() {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, module: p.module },
      create: p,
    });
  }

  const permMap = Object.fromEntries(
    (await prisma.permission.findMany()).map((p) => [p.key, p.id]),
  );

  for (const item of MENU_ITEMS) {
    const requiredPermissionId = permMap[item.perm];
    if (!requiredPermissionId) continue;
    await prisma.menuItem.upsert({
      where: { key: item.key },
      update: {
        label: item.label,
        route: item.route,
        icon: item.icon,
        sortOrder: item.sortOrder,
        requiredPermissionId,
      },
      create: {
        key: item.key,
        label: item.label,
        route: item.route,
        icon: item.icon,
        sortOrder: item.sortOrder,
        requiredPermissionId,
      },
    });
  }

  const seedPasswordHash = await hashPassword(SEED_DEFAULT_PASSWORD);
  for (const u of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, isAdmin: u.isAdmin, passwordHash: seedPasswordHash },
      create: {
        email: u.email,
        name: u.name,
        isAdmin: u.isAdmin,
        passwordHash: seedPasswordHash,
        mfaRequired: false,
      },
    });

    if (!u.isAdmin) {
      const keys = PROFILE_PERMISSIONS[u.profile] ?? [];
      for (const key of keys) {
        const permissionId = permMap[key];
        if (!permissionId) continue;
        await prisma.userPermissionOverride.upsert({
          where: { userId_permissionId: { userId: user.id, permissionId } },
          update: { granted: true },
          create: { userId: user.id, permissionId, granted: true },
        });
      }
    }
  }

  const complianceRules: {
    modality: FundModality;
    assetClass: AssetClass;
    minPercentage: number;
  }[] = [
    { modality: 'fidc', assetClass: 'direito_creditorio', minPercentage: 67 },
    { modality: 'fii', assetClass: 'imoveis', minPercentage: 75 },
    { modality: 'fia', assetClass: 'acoes', minPercentage: 67 },
    { modality: 'fi_rf', assetClass: 'renda_fixa', minPercentage: 80 },
    { modality: 'fi_cambio', assetClass: 'outro', minPercentage: 80 },
  ];

  for (const rule of complianceRules) {
    await prisma.complianceRule.upsert({
      where: {
        modality_assetClass: { modality: rule.modality, assetClass: rule.assetClass },
      },
      update: { minPercentage: rule.minPercentage },
      create: rule,
    });
  }

  const NEXT_CORE_CNPJ = '68057459000165';
  const LEGACY_DEMO_CNPJ = '00000000000191';

  const nextCoreData = {
    name: 'Next Core FIDC',
    legalName: 'NEXT CORE FUNDO DE INVESTIMENTO EM DIREITOS CREDITÓRIOS RESPONSABILIDADE LIMITADA',
    cnpj: NEXT_CORE_CNPJ,
    modality: 'fidc' as const,
    status: 'ativo' as const,
    targetAudience: 'Investidores qualificados',
    inceptionDate: new Date('2025-10-16'),
    website: 'https://nextcorefidc.com.br',
    registeredAddress: 'Av. Brigadeiro Faria Lima, 3900, Conj. 601, Itaim Bibi, São Paulo/SP',
    description:
      'FIDC com cotas sênior focadas em operações de renda variável, com rentabilidade alvo CDI+4% a CDI+5%.',
    contactEmail: 'contato@nextcorefidc.com.br',
    contactPhone: '+55 (11) 95610-1991',
    regulatoryLimitsJson: { min_direitos_creditorios_pct: 67 },
    extraInfoJson: {
      regulator: 'CVM',
      quotaClasses: [
        {
          name: 'Cota Sênior I',
          targetYield: 'CDI + 4% a.a.',
          termMonths: 12,
          amortization: 'Mensal',
          liquidity: 'Mensal',
          risk: 'Baixo',
          minAmount: 10000,
        },
        {
          name: 'Cota Sênior II',
          targetYield: 'CDI + 5% a.a.',
          termMonths: 36,
          amortization: 'No vencimento',
          liquidity: 'No vencimento',
          risk: 'Baixo',
          minAmount: 10000,
        },
      ],
    },
  };

  const existingFund =
    (await prisma.fund.findUnique({ where: { cnpj: NEXT_CORE_CNPJ } })) ??
    (await prisma.fund.findUnique({ where: { cnpj: LEGACY_DEMO_CNPJ } }));

  const fund = existingFund
    ? await prisma.fund.update({
        where: { id: existingFund.id },
        data: nextCoreData,
      })
    : await prisma.fund.create({ data: nextCoreData });

  const cotistasCount = await seedCotistasFromDataJson(fund.id);
  console.log(`Seed cotistas OK: ${cotistasCount} cliente(s) de prisma/data/clients.json`);

  console.log('Seed base OK — iniciando backfill de rendimentos (BCB)...');
  try {
    const n = await backfillAllActiveYields();
    console.log(`Backfill OK: ${n} registros de rendimento`);
  } catch (err) {
    console.warn('Backfill de yields falhou (rode npm run db:backfill-yields depois):', err);
  }

  const [usersCount, linksCount, yieldsCount] = await Promise.all([
    prisma.user.count(),
    prisma.partyFundLink.count(),
    prisma.cotistaDailyYield.count(),
  ]);
  console.log(
    `Seed completed — users=${usersCount} fundLinks=${linksCount} dailyYields=${yieldsCount}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
