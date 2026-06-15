import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as cotistaService from '../services/cotista.service.js';

export const cotistasRouter = router({
  list: permissionProcedure('cotistas.read')
    .input(z.object({ status: z.string().optional(), page: z.number().optional() }).optional())
    .query(({ input, ctx }) =>
      cotistaService.listCotistas(ctx.permissions, ctx.user.isAdmin, input?.status),
    ),

  getById: permissionProcedure('cotistas.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input, ctx }) =>
      cotistaService.getCotistaById(input.id, ctx.permissions, ctx.user.isAdmin),
    ),

  approve: permissionProcedure('cotistas.approve')
    .input(z.object({ id: z.string().uuid(), expiresAt: z.string() }))
    .mutation(({ input, ctx }) =>
      cotistaService.approveCotista(input.id, input.expiresAt, ctx.user.id, ctx.ip),
    ),

  reject: permissionProcedure('cotistas.approve')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      cotistaService.rejectCotista(input.id, input.reason, ctx.user.id, ctx.ip),
    ),
});
