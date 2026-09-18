import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as investidosService from '../services/investidos.service.js';

const assetClassSchema = z.enum([
  'direito_creditorio',
  'imoveis',
  'acoes',
  'renda_fixa',
  'derivativos',
  'cotas_fundo_investimento',
  'outro',
]);

export const investidosRouter = router({
  list: permissionProcedure('investidos.read')
    .input(z.object({ fundId: z.string().uuid().optional() }).optional())
    .query(({ input }) => investidosService.listInvestidos(input?.fundId)),

  create: permissionProcedure('investidos.write')
    .input(
      z.object({
        fundId: z.string().uuid(),
        assetClass: assetClassSchema,
        title: z.string().min(1),
        amount: z.number().positive(),
        justification: z.string().min(1),
        cedenteId: z.string().uuid().optional(),
        acquisitionDocumentUri: z.string().optional(),
        paymentProofUri: z.string().optional(),
        acquiredAt: z.string(),
      }),
    )
    .mutation(({ input, ctx }) => investidosService.createInvestido(input, ctx.user.id, ctx.ip)),
});
