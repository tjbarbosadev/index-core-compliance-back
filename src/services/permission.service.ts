import { prisma } from '../db/index.js';

export async function resolveUserPermissions(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];

  if (user.isAdmin) {
    const all = await prisma.permission.findMany({ select: { key: true } });
    return all.map((p) => p.key);
  }

  const fromGroups = await prisma.groupPermission.findMany({
    where: {
      granted: true,
      group: { userGroups: { some: { userId } } },
    },
    include: { permission: true },
  });

  const overrides = await prisma.userPermissionOverride.findMany({
    where: { userId },
    include: { permission: true },
  });

  const keys = new Set(fromGroups.map((gp) => gp.permission.key));
  for (const o of overrides) {
    if (o.granted) keys.add(o.permission.key);
    else keys.delete(o.permission.key);
  }
  return [...keys];
}

export async function userHasPermission(
  userId: string,
  key: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  const perms = await resolveUserPermissions(userId);
  return perms.includes(key);
}

export function hasPermissionInList(permissions: string[], key: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return permissions.includes(key);
}
