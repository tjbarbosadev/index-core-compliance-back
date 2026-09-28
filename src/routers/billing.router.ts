import { z } from 'zod';
import { router, adminProcedure } from '../trpc/procedures.js';
import {
  BILLING_VENDORS,
  createInvoice,
  deleteInvoice,
  getBillingOverview,
  listInvoices,
  setInvoiceStatus,
  updateInvoice,
} from '../services/vendor-billing.service.js';

const vendorSchema = z.enum(BILLING_VENDORS);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (AAAA-MM-DD)');
const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Competência inválida (AAAA-MM)');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const invoiceInputSchema = z.object({
  vendor: vendorSchema,
  referenceMonth: monthSchema,
  description: optionalText(255),
  amount: z.number().positive().max(10_000_000),
  dueDate: isoDateSchema,
  boletoLine: optionalText(64),
  boletoUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  notes: optionalText(2000),
});

export const billingRouter = router({
  overview: adminProcedure.query(() => getBillingOverview()),

  invoices: router({
    list: adminProcedure
      .input(
        z
          .object({
            vendor: vendorSchema.optional(),
            status: z.enum(['pendente', 'vencida', 'pago', 'cancelado']).optional(),
          })
          .optional(),
      )
      .query(({ input }) => listInvoices(input ?? {})),

    create: adminProcedure
      .input(invoiceInputSchema)
      .mutation(({ input, ctx }) => createInvoice(input, ctx.user.id)),

    update: adminProcedure
      .input(z.object({ id: z.string().uuid(), data: invoiceInputSchema.partial() }))
      .mutation(({ input, ctx }) => updateInvoice(input.id, input.data, ctx.user.id)),

    markPaid: adminProcedure
      .input(z.object({ id: z.string().uuid(), paidAt: isoDateSchema.optional() }))
      .mutation(({ input, ctx }) => setInvoiceStatus(input.id, 'pago', ctx.user.id, input.paidAt)),

    reopen: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ input, ctx }) => setInvoiceStatus(input.id, 'pendente', ctx.user.id)),

    cancel: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ input, ctx }) => setInvoiceStatus(input.id, 'cancelado', ctx.user.id)),

    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ input, ctx }) => deleteInvoice(input.id, ctx.user.id)),
  }),
});
