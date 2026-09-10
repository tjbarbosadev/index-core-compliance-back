import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as cotistaService from '../services/cotista.service.js';

const positionSchema = z.object({
  id: z.string().uuid().optional(),
  fundId: z.string().uuid(),
  quotaType: z.enum(['senior_i', 'senior_ii']),
  quotaCount: z.number().int().positive(),
  contractStartDate: z.string().nullable().optional(),
  contractEndDate: z.string().nullable().optional(),
});

const cotistaWriteSchema = z.object({
  legalName: z.string().min(1),
  cpfCnpj: z.string().min(11),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  positions: z.array(positionSchema).min(1),
});

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

  listYields: permissionProcedure('cotistas.read')
    .input(
      z.object({
        id: z.string().uuid(),
        date: z.string().optional(),
        yearMonth: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        limit: z.number().int().positive().max(365).optional(),
        partyFundLinkId: z.string().uuid().optional(),
      }),
    )
    .query(({ input }) =>
      cotistaService.getCotistaYields(input.id, {
        date: input.date,
        yearMonth: input.yearMonth,
        limit: input.limit,
        partyFundLinkId: input.partyFundLinkId,
      }),
    ),

  listAmortizations: permissionProcedure('cotistas.read')
    .input(
      z.object({
        id: z.string().uuid(),
        partyFundLinkId: z.string().uuid().optional(),
      }),
    )
    .query(({ input }) => cotistaService.getCotistaAmortizations(input.id, input.partyFundLinkId)),

  create: permissionProcedure('cotistas.write')
    .input(cotistaWriteSchema)
    .mutation(({ input, ctx }) =>
      cotistaService.createCotista(
        {
          ...input,
          email: input.email || undefined,
          phone: input.phone || undefined,
        },
        ctx.user.id,
        ctx.ip,
      ),
    ),

  update: permissionProcedure('cotistas.write')
    .input(cotistaWriteSchema.extend({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => {
      const { id, ...data } = input;
      return cotistaService.updateCotista(
        id,
        {
          ...data,
          email: data.email || undefined,
          phone: data.phone || undefined,
        },
        ctx.user.id,
        ctx.ip,
      );
    }),

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

  getFimDocuments: permissionProcedure('cotistas.view_kyc')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const { getFimDocumentsForCotista } = await import('../lib/nextcorefim/fim-documents.js');
      return getFimDocumentsForCotista(input.id, ctx.permissions, ctx.user.isAdmin);
    }),
});
