import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user)
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada' });
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const permissionProcedure = (key: string) =>
  protectedProcedure.use(({ ctx, next }) => {
    if (!ctx.user.isAdmin && !ctx.permissions.includes(key)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Permissão ausente' });
    }
    return next({ ctx });
  });

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isAdmin && !ctx.permissions.includes('admin.manage_access')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Permissão ausente' });
  }
  return next({ ctx });
});
