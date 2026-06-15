import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import { mapAuditLog, searchAudit } from '../services/audit.service.js';

export const auditRouter = router({
  search: permissionProcedure('audit.read')
    .input(
      z.object({
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        userId: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().min(1).max(500).optional(),
      }),
    )
    .query(async ({ input }) => {
      const logs = await searchAudit(input);
      return logs.map(mapAuditLog);
    }),
});
