import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc/procedures.js';
import { prisma } from '../db/index.js';
import { setUserPassword } from '../services/auth.service.js';
import {
  TAB_ACCESS_MAP,
  TAB_LABELS,
  createUserWithTabAccess,
  deactivateUser,
  listUsersWithTabAccess,
  setUserTabAccess,
  type TabAccessLevel,
  type TabKey,
} from '../services/user-access.service.js';

const tabAccessSchema = z.record(
  z.enum(Object.keys(TAB_ACCESS_MAP) as [TabKey, ...TabKey[]]),
  z.enum(['read', 'write']).nullable(),
);

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

export const usersRouter = router({
  list: adminProcedure.query(async () => listUsersWithTabAccess()),

  tabCatalog: adminProcedure.query(() =>
    (Object.keys(TAB_ACCESS_MAP) as TabKey[]).map((key) => ({
      key,
      label: TAB_LABELS[key],
      canWrite: Boolean(TAB_ACCESS_MAP[key].write),
    })),
  ),

  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(2),
        password: z
          .string()
          .optional()
          .transform((v) => {
            const trimmed = v?.trim();
            return trimmed ? trimmed : undefined;
          })
          .pipe(z.string().min(8).optional()),
        isAdmin: z.boolean().optional().default(false),
        tabs: tabAccessSchema.default({}),
      }),
    )
    .mutation(({ input, ctx }) =>
      createUserWithTabAccess({
        email: input.email,
        name: input.name,
        password: input.password,
        isAdmin: input.isAdmin,
        tabs: input.tabs as Partial<Record<TabKey, TabAccessLevel>>,
        createdBy: ctx.user.id,
      }),
    ),

  setPassword: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        password: z.string().min(8),
      }),
    )
    .mutation(async ({ input }) => {
      await setUserPassword(input.userId, input.password);
      return { success: true };
    }),

  deactivate: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(({ input, ctx }) => deactivateUser(input.userId, ctx.user.id)),

  setTabAccess: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        tabs: tabAccessSchema,
      }),
    )
    .mutation(({ input, ctx }) =>
      setUserTabAccess(
        input.userId,
        input.tabs as Partial<Record<TabKey, TabAccessLevel>>,
        ctx.user.id,
      ),
    ),
});
