import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { env } from './lib/env.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerScheduledJobs } from './lib/scheduler.js';

const app = express();

app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

registerAuthRoutes(app);

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  }),
);

registerScheduledJobs();

app.listen(env.port, () => {
  console.log(`IndexCore API listening on http://localhost:${env.port}`);
});
