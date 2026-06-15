import { router, protectedProcedure } from '../trpc/procedures.js';
import { buildUserWithPermissions, logoutUser, COOKIE_NAME } from '../services/auth.service.js';

export const authRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    return buildUserWithPermissions(ctx.user.id);
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionId) {
      await logoutUser(ctx.sessionId);
    }
    ctx.res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict' });
    return { success: true };
  }),

  verifyMfa: protectedProcedure.mutation(() => ({ valid: true })),
  enableMfa: protectedProcedure.mutation(() => ({ qrCode: '' })),
});
