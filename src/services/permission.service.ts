import { prisma } from '../db/index.js';

export async function resolveUserPermissions(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];

  if (user.isAdmin) {
    const all = await prisma.permission.findMany({ select: { key: true } });
    return all.map((p) => p.key);
  }

  const overrides = await prisma.userPermissionOverride.findMany({
    where: { userId, granted: true },
    include: { permission: true },
  });

  return overrides.map((o) => o.permission.key);
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
