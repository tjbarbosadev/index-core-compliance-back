import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as fundService from '../services/fund.service.js';

const fundModalitySchema = z.enum([
  'fidc',
  'fii',
  'fia',
  'fim',
  'fi_infra',
  'fip',
  'fi_debentures',
  'fiagro',
  'fi_rf',
  'fi_cambio',
]);

const fundStatusSchema = z.enum(['ativo', 'inativo', 'liquidacao', 'encerrado']);

const createFundSchema = z.object({
  name: z.string().min(3),
  cnpj: z.string().min(14),
  cvmCode: z.string().optional(),
  modality: fundModalitySchema,
  targetAudience: z.string().optional(),
  status: fundStatusSchema.optional(),
  regulatoryLimitsJson: z.record(z.string(), z.number()).optional(),
});

export const fundsRouter = router({
  list: permissionProcedure('fundos.read')
    .input(
      z
        .object({
          status: fundStatusSchema.optional(),
          modality: fundModalitySchema.optional(),
        })
        .optional(),
    )
    .query(({ input }) => fundService.listFunds(input)),

  getById: permissionProcedure('fundos.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => fundService.getFundById(input.id)),

  create: permissionProcedure('fundos.write')
    .input(createFundSchema)
    .mutation(({ input, ctx }) => fundService.createFund(input, ctx.user.id, ctx.ip)),

  update: permissionProcedure('fundos.write')
    .input(z.object({ id: z.string().uuid() }).merge(createFundSchema.partial()))
    .mutation(({ input, ctx }) => {
      const { id, ...data } = input;
      return fundService.updateFund(id, data, ctx.user.id, ctx.ip);
    }),
});
