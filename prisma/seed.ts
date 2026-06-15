import { PrismaClient, FundModality, AssetClass } from '@prisma/client';

const prisma = new PrismaClient();

const PERMISSIONS = [
  { key: 'dashboard.read', description: 'Ver dashboard', module: 'dashboard' },
  { key: 'fundos.read', description: 'Listar fundos', module: 'fundos' },
  { key: 'fundos.write', description: 'Criar e editar fundos', module: 'fundos' },
  { key: 'onboarding.read', description: 'Ver onboardings', module: 'onboarding' },
  { key: 'onboarding.write', description: 'Criar e avançar onboarding', module: 'onboarding' },
  { key: 'onboarding.approve', description: 'Aprovar/rejeitar onboarding', module: 'onboarding' },
  { key: 'cotistas.read', description: 'Listar cotistas', module: 'cotistas' },
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
  { key: 'admin.manage_access', description: 'Gerenciar grupos e usuários', module: 'admin' },
] as const;

const GROUP_PERMISSIONS: Record<string, string[]> = {
  Administrador: PERMISSIONS.map((p) => p.key),
  Compliance: [
    'dashboard.read',
    'fundos.read',
    'fundos.write',
    'onboarding.read',
    'onboarding.write',
    'onboarding.approve',
    'cotistas.read',
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

const SEED_USERS = [
  { email: 'admin@indexcore.local', name: 'Administrador', group: 'Administrador', isAdmin: true },
  { email: 'compliance@indexcore.local', name: 'Compliance', group: 'Compliance', isAdmin: false },
  { email: 'gestao@indexcore.local', name: 'Gestão', group: 'Gestão', isAdmin: false },
  {
    email: 'operacional@indexcore.local',
    name: 'Operacional',
    group: 'Operacional',
    isAdmin: false,
  },
  { email: 'ouvidoria@indexcore.local', name: 'Ouvidoria', group: 'Ouvidoria', isAdmin: false },
  { email: 'fiduciaria@indexcore.local', name: 'Fiduciária', group: 'Fiduciária', isAdmin: false },
];

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

  for (const [groupName, keys] of Object.entries(GROUP_PERMISSIONS)) {
    const group = await prisma.permissionGroup.upsert({
      where: { name: groupName },
      update: {},
      create: {
        name: groupName,
        description: groupName,
        mfaRequired: ['Administrador', 'Compliance', 'Gestão', 'Fiduciária'].includes(groupName),
        isSystem: true,
      },
    });

    await prisma.groupPermission.deleteMany({ where: { groupId: group.id } });
    for (const key of keys) {
      const permissionId = permMap[key];
      if (!permissionId) continue;
      await prisma.groupPermission.create({
        data: { groupId: group.id, permissionId, granted: true },
      });
    }
  }

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

  const groups = Object.fromEntries(
    (await prisma.permissionGroup.findMany()).map((g) => [g.name, g.id]),
  );

  for (const u of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, isAdmin: u.isAdmin },
      create: {
        email: u.email,
        name: u.name,
        isAdmin: u.isAdmin,
        mfaRequired: false,
      },
    });
    const groupId = groups[u.group];
    if (groupId) {
      await prisma.userGroup.upsert({
        where: { userId_groupId: { userId: user.id, groupId } },
        update: {},
        create: { userId: user.id, groupId },
      });
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

  console.log('Seed completed');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
