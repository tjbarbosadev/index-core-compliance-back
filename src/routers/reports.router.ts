import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import { hasPermissionInList } from '../services/permission.service.js';
import * as reportsService from '../services/reports.service.js';

export const reportsRouter = router({
  generate: permissionProcedure('reports.read')
    .input(
      z.object({
        type: z.enum(['gestao', 'compliance']),
        from: z.string(),
        to: z.string(),
      }),
    )
    .mutation(({ input, ctx }) => {
      if (input.type === 'compliance') {
        if (!hasPermissionInList(ctx.permissions, 'compliance.read', ctx.user.isAdmin)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Permissão ausente' });
        }
      } else if (
        !hasPermissionInList(ctx.permissions, 'transactions.read', ctx.user.isAdmin) &&
        !hasPermissionInList(ctx.permissions, 'fundos.read', ctx.user.isAdmin)
      ) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Permissão ausente' });
      }
      return reportsService.generateReport(input);
    }),
});
