import { prisma } from '../db/index.js';
import { APP_ERROR } from '../lib/errors.js';
import { hashPassword } from './auth.service.js';
import { resolveUserPermissions } from './permission.service.js';

/** Abas do admin e permissões read/write correspondentes. */
export const TAB_ACCESS_MAP = {
  dashboard: { read: 'dashboard.read', write: null },
  fundos: { read: 'fundos.read', write: 'fundos.write' },
  onboarding: { read: 'onboarding.read', write: 'onboarding.write' },
  cotistas: { read: 'cotistas.read', write: 'cotistas.write' },
  cedentes: { read: 'cedentes.read', write: 'cedentes.write' },
  transacoes: { read: 'transactions.read', write: 'transactions.write' },
  compliance: { read: 'compliance.read', write: 'compliance.write' },
  calendario: { read: 'regulatory.read', write: 'regulatory.approve' },
  auditoria: { read: 'audit.read', write: null },
  administracao: { read: 'admin.manage_access', write: 'admin.manage_access' },
} as const;

export type TabKey = keyof typeof TAB_ACCESS_MAP;
export type TabAccessLevel = 'read' | 'write' | null;

export const TAB_LABELS: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  fundos: 'Fundos',
  onboarding: 'Onboarding',
  cotistas: 'Cotistas',
  cedentes: 'Cedentes',
  transacoes: 'Transações',
  compliance: 'Compliance',
  calendario: 'Calendário',
  auditoria: 'Auditoria',
  administracao: 'Administração',
};

export function deriveTabAccess(permissions: string[]): Record<TabKey, TabAccessLevel> {
  const result = {} as Record<TabKey, TabAccessLevel>;
  for (const [tab, keys] of Object.entries(TAB_ACCESS_MAP) as [
    TabKey,
    (typeof TAB_ACCESS_MAP)[TabKey],
  ][]) {
    if (keys.write && permissions.includes(keys.write)) {
      result[tab] = 'write';
    } else if (permissions.includes(keys.read)) {
      result[tab] = 'read';
    } else {
      result[tab] = null;
    }
  }
  return result;
}

export async function setUserTabAccess(
  userId: string,
  tabs: Partial<Record<TabKey, TabAccessLevel>>,
  createdBy?: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw APP_ERROR.NOT_FOUND('Usuário');

  const allPerms = await prisma.permission.findMany();
  const byKey = Object.fromEntries(allPerms.map((p) => [p.key, p.id]));

  const keysToGrant = new Set<string>();
  const managedKeys = new Set<string>();

  for (const [tab, level] of Object.entries(tabs) as [TabKey, TabAccessLevel][]) {
    const map = TAB_ACCESS_MAP[tab];
    if (!map) continue;
    managedKeys.add(map.read);
    if (map.write) managedKeys.add(map.write);

    if (level === 'write') {
      keysToGrant.add(map.read);
      if (map.write) keysToGrant.add(map.write);
    } else if (level === 'read') {
      keysToGrant.add(map.read);
    }
  }

  for (const key of managedKeys) {
    const permissionId = byKey[key];
    if (!permissionId) continue;
    const granted = keysToGrant.has(key);
    await prisma.userPermissionOverride.upsert({
      where: { userId_permissionId: { userId, permissionId } },
      update: { granted, createdBy },
      create: { userId, permissionId, granted, createdBy },
    });
  }

  const permissions = await resolveUserPermissions(userId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    permissions,
    tabAccess: deriveTabAccess(permissions),
  };
}

export async function createUserWithTabAccess(input: {
  email: string;
  name: string;
  password: string;
  tabs: Partial<Record<TabKey, TabAccessLevel>>;
  createdBy?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw APP_ERROR.CONFLICT('E-mail já cadastrado');

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      isAdmin: false,
      status: 'active',
    },
  });

  return setUserTabAccess(user.id, input.tabs, input.createdBy);
}

export async function listUsersWithTabAccess() {
  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
  });

  return Promise.all(
    users.map(async (u) => {
      const permissions = await resolveUserPermissions(u.id);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        isAdmin: u.isAdmin,
        status: u.status,
        permissions,
        tabAccess: deriveTabAccess(permissions),
      };
    }),
  );
}
