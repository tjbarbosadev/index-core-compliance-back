import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as documentService from '../services/document.service.js';

export const documentsRouter = router({
  getUploadUrl: permissionProcedure('documents.write')
    .input(
      z.object({
        partyId: z.string().uuid(),
        type: z.string(),
        mimeType: z.string(),
        fileName: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) => documentService.getDocumentUploadUrl(input, ctx.user.id)),

  confirmUpload: permissionProcedure('documents.write')
    .input(z.object({ documentId: z.string().uuid(), hash: z.string().min(64).max(64) }))
    .mutation(({ input, ctx }) =>
      documentService.confirmDocumentUpload(input.documentId, input.hash, ctx.user.id),
    ),

  listByParty: permissionProcedure('documents.read')
    .input(z.object({ partyId: z.string().uuid() }))
    .query(({ input, ctx }) =>
      documentService.listDocumentsByParty(input.partyId, ctx.permissions, ctx.user.isAdmin),
    ),

  validate: permissionProcedure('documents.approve')
    .input(
      z.object({
        id: z.string().uuid(),
        approved: z.boolean(),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      documentService.validateDocument(input.id, input.approved, input.reason, ctx.user.id, ctx.ip),
    ),
});
