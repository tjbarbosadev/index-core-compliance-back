import { router } from '../trpc/procedures.js';
import { healthRouter } from '../routers/health.router.js';
import { authRouter } from '../routers/auth.router.js';
import { menuRouter, usersRouter } from '../routers/admin.router.js';
import { fundsRouter } from '../routers/funds.router.js';
import { documentsRouter } from '../routers/documents.router.js';
import { onboardingRouter, cedenteOnboardingRouter } from '../routers/onboarding.router.js';
import { cotistasRouter } from '../routers/cotistas.router.js';
import { auditRouter } from '../routers/audit.router.js';
import { dashboardRouter } from '../routers/dashboard.router.js';
import { kycRouter } from '../routers/kyc.router.js';
import { complianceRouter } from '../routers/compliance.router.js';
import { investidosRouter } from '../routers/investidos.router.js';
import { transactionsRouter } from '../routers/transactions.router.js';
import { reportsRouter } from '../routers/reports.router.js';
import { whatsappAlertsRouter } from '../routers/whatsapp-alerts.router.js';

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  menu: menuRouter,
  users: usersRouter,
  funds: fundsRouter,
  documents: documentsRouter,
  onboarding: onboardingRouter,
  cedenteOnboarding: cedenteOnboardingRouter,
  cotistas: cotistasRouter,
  audit: auditRouter,
  dashboard: dashboardRouter,
  kyc: kycRouter,
  compliance: complianceRouter,
  investidos: investidosRouter,
  transactions: transactionsRouter,
  reports: reportsRouter,
  whatsappAlerts: whatsappAlertsRouter,
});

export type AppRouter = typeof appRouter;
