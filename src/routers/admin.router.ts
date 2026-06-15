import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc/procedures.js';
import { prisma } from '../db/index.js';

export const menuRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const items = await prisma.menuItem.findMany({
      where: { active: true },
      include: { requiredPermission: true },
      orderBy: { sortOrder: 'asc' },
    });

    return items
      .filter((item) => ctx.user.isAdmin || ctx.permissions.includes(item.requiredPermission.key))
      .map((item) => ({
        id: item.id,
        key: item.key,
        label: item.label,
        route: item.route,
        icon: item.icon ?? undefined,
        sortOrder: item.sortOrder,
        requiredPermission: item.requiredPermission.key,
      }));
  }),
});

export const groupsRouter = router({
  list: adminProcedure.query(async () => {
    const groups = await prisma.permissionGroup.findMany({
      include: {
        groupPermissions: { include: { permission: true } },
      },
      orderBy: { name: 'asc' },
    });

    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description ?? undefined,
      mfaRequired: g.mfaRequired,
      isSystem: g.isSystem,
      permissionKeys: g.groupPermissions.filter((gp) => gp.granted).map((gp) => gp.permission.key),
    }));
  }),

  updatePermissions: adminProcedure
    .input(z.object({ groupId: z.string().uuid(), permissionKeys: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const group = await prisma.permissionGroup.findUnique({ where: { id: input.groupId } });
      if (!group) throw new Error('Grupo não encontrado');

      const allPerms = await prisma.permission.findMany();
      await prisma.groupPermission.deleteMany({ where: { groupId: input.groupId } });
      for (const p of allPerms) {
        if (input.permissionKeys.includes(p.key)) {
          await prisma.groupPermission.create({
            data: { groupId: input.groupId, permissionId: p.id, granted: true },
          });
        }
      }

      const updated = await prisma.permissionGroup.findUnique({
        where: { id: input.groupId },
        include: { groupPermissions: { include: { permission: true } } },
      });

      return {
        id: updated!.id,
        name: updated!.name,
        description: updated!.description ?? undefined,
        mfaRequired: updated!.mfaRequired,
        isSystem: updated!.isSystem,
        permissionKeys: updated!.groupPermissions
          .filter((gp) => gp.granted)
          .map((gp) => gp.permission.key),
      };
    }),
});

export const usersRouter = router({
  list: adminProcedure.query(async () => {
    const users = await prisma.user.findMany({
      include: { userGroups: true },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      groupIds: u.userGroups.map((ug) => ug.groupId),
    }));
  }),

  assignGroups: adminProcedure
    .input(z.object({ userId: z.string().uuid(), groupIds: z.array(z.string().uuid()) }))
    .mutation(async ({ input }) => {
      await prisma.userGroup.deleteMany({ where: { userId: input.userId } });
      for (const groupId of input.groupIds) {
        await prisma.userGroup.create({ data: { userId: input.userId, groupId } });
      }
      const user = await prisma.user.findUnique({ where: { id: input.userId } });
      return { id: user!.id };
    }),
});
