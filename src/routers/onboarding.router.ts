import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as onboardingService from '../services/onboarding.service.js';

const createSchema = z.object({
  partyType: z.enum(['pf', 'pj']),
  cpfCnpj: z.string().min(11),
  legalName: z.string().min(3),
  fundId: z.string().uuid(),
  fundName: z.string().optional(),
  quotaType: z
    .enum(['senior', 'senior_i', 'senior_ii', 'mezanino', 'subordinada', 'unica'])
    .optional(),
});

export const onboardingRouter = router({
  list: permissionProcedure('onboarding.read').query(() =>
    onboardingService.listOnboardingProcesses('cotista'),
  ),

  getById: permissionProcedure('onboarding.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => onboardingService.getOnboardingById(input.id, 'cotista')),

  create: permissionProcedure('onboarding.write')
    .input(createSchema)
    .mutation(({ input }) => onboardingService.createOnboarding({ ...input, kind: 'cotista' })),

  advanceStep: permissionProcedure('onboarding.write')
    .input(z.object({ id: z.string().uuid(), stepData: z.record(z.unknown()) }))
    .mutation(({ input, ctx }) =>
      onboardingService.advanceFromWebPayload(input.id, 'cotista', input.stepData, ctx.user.id),
    ),

  approve: permissionProcedure('onboarding.approve')
    .input(z.object({ id: z.string().uuid(), justification: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      onboardingService.approveOnboarding(
        input.id,
        'cotista',
        ctx.user.id,
        ctx.ip,
        input.justification,
      ),
    ),

  confirmDeposit: permissionProcedure('transactions.approve')
    .input(
      z.object({
        onboardingId: z.string().uuid(),
        amount: z.number().positive(),
        proofUri: z.string().optional(),
        quotaType: z
          .enum(['senior', 'senior_i', 'senior_ii', 'mezanino', 'subordinada', 'unica'])
          .optional(),
        quotaCount: z.number().int().nonnegative().optional(),
        bankAccount: z
          .object({
            bankCode: z.string().min(1),
            branch: z.string().min(1),
            account: z.string().min(1),
            accountType: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(({ input, ctx }) => onboardingService.confirmDeposit(input, ctx.user.id, ctx.ip)),

  reject: permissionProcedure('onboarding.approve')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      onboardingService.rejectOnboarding(input.id, 'cotista', input.reason, ctx.user.id, ctx.ip),
    ),

  delete: permissionProcedure('onboarding.approve')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      onboardingService.softDeleteOnboarding(input.id, 'cotista', ctx.user.id, ctx.ip),
    ),
});

export const cedenteOnboardingRouter = router({
  list: permissionProcedure('cedentes.read').query(() =>
    onboardingService.listOnboardingProcesses('cedente'),
  ),

  getById: permissionProcedure('cedentes.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => onboardingService.getOnboardingById(input.id, 'cedente')),

  create: permissionProcedure('cedentes.write')
    .input(
      z.object({
        cnpj: z.string().min(14),
        legalName: z.string().min(3),
        fundId: z.string().uuid(),
        fundName: z.string().optional(),
      }),
    )
    .mutation(({ input }) =>
      onboardingService.createOnboarding({
        partyType: 'pj',
        cpfCnpj: input.cnpj,
        legalName: input.legalName,
        fundId: input.fundId,
        kind: 'cedente',
      }),
    ),

  advanceStep: permissionProcedure('cedentes.write')
    .input(z.object({ id: z.string().uuid(), stepData: z.record(z.unknown()) }))
    .mutation(({ input, ctx }) =>
      onboardingService.advanceFromWebPayload(input.id, 'cedente', input.stepData, ctx.user.id),
    ),

  approve: permissionProcedure('cedentes.approve')
    .input(z.object({ id: z.string().uuid(), justification: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      onboardingService.approveOnboarding(
        input.id,
        'cedente',
        ctx.user.id,
        ctx.ip,
        input.justification,
      ),
    ),

  reject: permissionProcedure('cedentes.approve')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      onboardingService.rejectOnboarding(input.id, 'cedente', input.reason, ctx.user.id, ctx.ip),
    ),

  delete: permissionProcedure('cedentes.approve')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      onboardingService.softDeleteOnboarding(input.id, 'cedente', ctx.user.id, ctx.ip),
    ),
});
