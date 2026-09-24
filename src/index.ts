import './lib/load-env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { env } from './lib/env.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerFilesRoutes } from './routes/files.routes.js';
import { registerV1Routes } from './routes/v1.routes.js';
import { registerPartnerAdminRoutes } from './routes/partner-admin.routes.js';
import { registerInternalRoutes } from './routes/internal.routes.js';
import { registerScheduledJobs } from './lib/scheduler.js';

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // Server-to-server (sem Origin) ou origin na allowlist de sites próprios
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key'],
    credentials: true,
  }),
);
app.use(cookieParser());

registerFilesRoutes(app);

app.use(express.json({ limit: '2mb' }));

registerAuthRoutes(app);
registerV1Routes(app);
registerPartnerAdminRoutes(app);
registerInternalRoutes(app);

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

registerScheduledJobs();

app.listen(env.port, () => {
  console.log(`opcore_api listening on http://localhost:${env.port}`);
});
