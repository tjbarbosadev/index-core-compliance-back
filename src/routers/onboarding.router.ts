import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as onboardingService from '../services/onboarding.service.js';
import * as cedenteService from '../services/cedente-onboarding.service.js';

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

const idInput = z.object({ id: z.string().uuid() });
const cedenteStageEnum = z.enum([
  'rascunho',
  'aguardando_assinatura',
  'em_analise_juridica',
  'pendencia_juridica',
  'em_analise_compliance',
  'aprovado',
  'rejeitado',
]);

export const cedenteOnboardingRouter = router({
  list: permissionProcedure('cedentes.read')
    .input(z.object({ stage: cedenteStageEnum.optional() }).optional())
    .query(({ input }) => cedenteService.listCedenteOnboardings({ stage: input?.stage })),

  getById: permissionProcedure('cedentes.read')
    .input(idInput)
    .query(({ input }) => cedenteService.getCedenteOnboarding(input.id)),

  create: permissionProcedure('cedentes.write')
    .input(
      z.object({
        cnpj: z.string().min(14),
        legalName: z.string().min(3),
        fundId: z.string().uuid(),
        fundName: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      cedenteService.createCedenteOnboarding(input, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  saveSection: permissionProcedure('cedentes.write')
    .input(
      z.object({
        id: z.string().uuid(),
        section: z.enum(['empresa', 'estrutura']),
        data: z.record(z.unknown()),
        advance: z.boolean().default(false),
      }),
    )
    .mutation(({ input, ctx }) =>
      cedenteService.saveCedenteSection(
        input.id,
        input.section,
        input.data,
        { advance: input.advance },
        { userId: ctx.user.id, ip: ctx.ip },
      ),
    ),

  requestDocumentUpload: permissionProcedure('cedentes.write')
    .input(
      z.object({
        id: z.string().uuid(),
        slot: z.string().min(1).max(100),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(100),
        size: z.number().int().positive(),
      }),
    )
    .mutation(({ input, ctx }) =>
      cedenteService.requestCedenteDocumentUpload(input.id, input, {
        userId: ctx.user.id,
        ip: ctx.ip,
      }),
    ),

  confirmDocumentUpload: permissionProcedure('cedentes.write')
    .input(z.object({ id: z.string().uuid(), documentId: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      cedenteService.confirmCedenteDocumentUpload(input.id, input.documentId, {
        userId: ctx.user.id,
        ip: ctx.ip,
      }),
    ),

  submitDocuments: permissionProcedure('cedentes.write')
    .input(idInput)
    .mutation(({ input, ctx }) =>
      cedenteService.submitCedenteDocuments(input.id, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  generateDocuments: permissionProcedure('cedentes.write')
    .input(idInput)
    .mutation(({ input, ctx }) =>
      cedenteService.generateCedenteDocuments(input.id, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  sendForSignature: permissionProcedure('cedentes.write')
    .input(idInput)
    .mutation(({ input, ctx }) =>
      cedenteService.sendCedenteForSignature(input.id, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  refreshSignatures: permissionProcedure('cedentes.write')
    .input(idInput)
    .mutation(({ input, ctx }) =>
      cedenteService.refreshCedenteSignatures(input.id, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  validateDocument: permissionProcedure('cedentes.legal_review')
    .input(
      z.object({
        id: z.string().uuid(),
        documentId: z.string().uuid(),
        approved: z.boolean(),
        reason: z.string().max(1000).optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      cedenteService.validateCedenteDocument(input.id, input, {
        userId: ctx.user.id,
        ip: ctx.ip,
      }),
    ),

  legalReview: permissionProcedure('cedentes.legal_review')
    .input(
      z.object({
        id: z.string().uuid(),
        decision: z.enum(['favoravel', 'pendencia', 'desfavoravel']),
        opinion: z.string().min(10).max(20_000),
        pendingItems: z.array(z.string().max(500)).max(50).optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      cedenteService.submitLegalReview(input.id, input, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  resubmitToLegal: permissionProcedure('cedentes.write')
    .input(idInput)
    .mutation(({ input, ctx }) =>
      cedenteService.resubmitCedenteToLegal(input.id, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  saveKycAml: permissionProcedure('cedentes.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        kyc: z.object({ pepFlag: z.boolean(), restrictiveListHit: z.boolean() }),
        aml: z.object({ lawfulOriginDeclared: z.boolean() }),
      }),
    )
    .mutation(({ input, ctx }) =>
      cedenteService.saveCedenteKycAml(input.id, input, { userId: ctx.user.id, ip: ctx.ip }),
    ),

  approve: permissionProcedure('cedentes.approve')
    .input(z.object({ id: z.string().uuid(), justification: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      cedenteService.approveCedenteOnboarding(input.id, input.justification, {
        userId: ctx.user.id,
        ip: ctx.ip,
      }),
    ),

  reject: permissionProcedure('cedentes.approve')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(({ input, ctx }) =>
      cedenteService.rejectCedenteOnboarding(input.id, input.reason, {
        userId: ctx.user.id,
        ip: ctx.ip,
      }),
    ),

  delete: permissionProcedure('cedentes.approve')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      onboardingService.softDeleteOnboarding(input.id, 'cedente', ctx.user.id, ctx.ip),
    ),
});
