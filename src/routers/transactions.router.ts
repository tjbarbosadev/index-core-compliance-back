import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as transactionsService from '../services/transactions.service.js';

const transactionTypeSchema = z.enum([
  'aporte',
  'resgate',
  'amortizacao',
  'rendimento',
  'compra_ativo',
  'venda_ativo',
]);

export const transactionsRouter = router({
  list: permissionProcedure('transactions.read')
    .input(
      z
        .object({
          fundId: z.string().uuid().optional(),
          partyId: z.string().uuid().optional(),
          type: transactionTypeSchema.optional(),
          limit: z.number().int().positive().max(500).optional(),
        })
        .optional(),
    )
    .query(({ input }) => transactionsService.listTransactions(input ?? {})),
});
