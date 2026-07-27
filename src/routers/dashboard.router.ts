import { z } from 'zod';
import { router, permissionProcedure } from '../trpc/procedures.js';
import * as dashboardService from '../services/dashboard.service.js';

export const dashboardRouter = router({
  summary: permissionProcedure('dashboard.read').query(async () => {
    return dashboardService.getSummary();
  }),

  recentActivity: permissionProcedure('dashboard.read')
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .query(async ({ input }) => {
      return dashboardService.getRecentActivity(input?.limit ?? 10);
    }),
});
