import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import { generateKycInputSchema, listKycInputSchema } from '../schemas/kyc.schema.js';
import * as kycService from '../services/kyc.service.js';

export const kycRouter = router({
  generate: permissionProcedure('compliance.write')
    .input(generateKycInputSchema)
    .mutation(({ input, ctx }) => kycService.generateKycReport(input, ctx.user.id, ctx.ip)),

  getById: permissionProcedure('compliance.read')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => kycService.getKycReportById(input.id)),

  list: permissionProcedure('compliance.read')
    .input(listKycInputSchema)
    .query(({ input }) => kycService.listKycReports(input)),
});
