import type { BillingVendor, VendorInvoice, VendorInvoiceStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { prisma } from '../db/index.js';
import { complianceApiClient } from '../lib/compliance/client.js';
import type { ProviderBillingOverview } from '../lib/compliance/types.js';
import { logAudit } from './audit.service.js';

export const BILLING_VENDORS = ['bigdatacorp', 'lemit', 'apollo'] as const;

export const VENDOR_LABELS: Record<BillingVendor, string> = {
  bigdatacorp: 'BigDataCorp',
  lemit: 'Lemit',
  apollo: 'Apollo.io',
};

export type InvoiceDisplayStatus = VendorInvoiceStatus | 'vencida';

export interface VendorInvoiceDto {
  id: string;
  vendor: BillingVendor;
  vendorLabel: string;
  referenceMonth: string;
  description: string | null;
  amount: number;
  dueDate: string;
  status: InvoiceDisplayStatus;
  daysUntilDue: number;
  boletoLine: string | null;
  boletoUrl: string | null;
  hasDocument: boolean;
  documentName: string | null;
  notes: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface InvoiceBucket {
  count: number;
  total: number;
}

export interface InvoiceSummary {
  overdue: InvoiceBucket;
  dueIn7Days: InvoiceBucket;
  dueIn30Days: InvoiceBucket;
  open: InvoiceBucket;
  paidThisMonth: InvoiceBucket;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Data de hoje (YYYY-MM-DD) no fuso de Brasília. */
export function todayIsoDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / DAY_MS);
}

export function displayStatus(
  invoice: Pick<VendorInvoice, 'status' | 'dueDate'>,
  today: string,
): InvoiceDisplayStatus {
  if (invoice.status === 'pendente' && isoDate(invoice.dueDate) < today) return 'vencida';
  return invoice.status;
}

export function toInvoiceDto(invoice: VendorInvoice, today: string): VendorInvoiceDto {
  const dueDate = isoDate(invoice.dueDate);
  return {
    id: invoice.id,
    vendor: invoice.vendor,
    vendorLabel: VENDOR_LABELS[invoice.vendor],
    referenceMonth: isoDate(invoice.referenceMonth).slice(0, 7),
    description: invoice.description,
    amount: Number(invoice.amount),
    dueDate,
    status: displayStatus(invoice, today),
    daysUntilDue: daysBetween(today, dueDate),
    boletoLine: invoice.boletoLine,
    boletoUrl: invoice.boletoUrl,
    hasDocument: Boolean(invoice.documentUri),
    documentName: invoice.documentName,
    notes: invoice.notes,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
  };
}

function bucket(items: VendorInvoiceDto[]): InvoiceBucket {
  return {
    count: items.length,
    total: Math.round(items.reduce((sum, i) => sum + i.amount, 0) * 100) / 100,
  };
}

export function summarizeInvoices(invoices: VendorInvoiceDto[], today: string): InvoiceSummary {
  const open = invoices.filter((i) => i.status === 'pendente' || i.status === 'vencida');
  const monthPrefix = today.slice(0, 7);
  return {
    overdue: bucket(open.filter((i) => i.status === 'vencida')),
    dueIn7Days: bucket(open.filter((i) => i.daysUntilDue >= 0 && i.daysUntilDue <= 7)),
    dueIn30Days: bucket(open.filter((i) => i.daysUntilDue >= 0 && i.daysUntilDue <= 30)),
    open: bucket(open),
    paidThisMonth: bucket(
      invoices.filter((i) => i.status === 'pago' && (i.paidAt ?? '').startsWith(monthPrefix)),
    ),
  };
}

export interface ListInvoicesInput {
  vendor?: BillingVendor;
  status?: InvoiceDisplayStatus;
}

export async function listInvoices(input: ListInvoicesInput = {}): Promise<VendorInvoiceDto[]> {
  const today = todayIsoDate();
  const rows = await prisma.vendorInvoice.findMany({
    where: { vendor: input.vendor },
    orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
  });
  const dtos = rows.map((row) => toInvoiceDto(row, today));
  return input.status ? dtos.filter((dto) => dto.status === input.status) : dtos;
}

export async function getBillingOverview() {
  const today = todayIsoDate();
  const [providersResult, rows] = await Promise.all([
    complianceApiClient.getProviderBilling().then(
      (value): { ok: true; value: ProviderBillingOverview } => ({ ok: true, value }),
      (error: unknown): { ok: false; error: string } => ({
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao consultar API de compliance',
      }),
    ),
    prisma.vendorInvoice.findMany({ orderBy: { dueDate: 'asc' } }),
  ]);

  const invoices = rows.map((row) => toInvoiceDto(row, today));
  return {
    today,
    providers: providersResult.ok ? providersResult.value : null,
    providersError: providersResult.ok ? null : providersResult.error,
    summary: summarizeInvoices(invoices, today),
    upcoming: invoices.filter((i) => i.status === 'pendente' || i.status === 'vencida'),
  };
}

export interface InvoiceInput {
  vendor: BillingVendor;
  referenceMonth: string;
  description?: string | null;
  amount: number;
  dueDate: string;
  boletoLine?: string | null;
  boletoUrl?: string | null;
  notes?: string | null;
}

function toData(input: Partial<InvoiceInput>) {
  return {
    vendor: input.vendor,
    referenceMonth: input.referenceMonth ? parseIsoDate(`${input.referenceMonth}-01`) : undefined,
    description: input.description,
    amount: input.amount,
    dueDate: input.dueDate ? parseIsoDate(input.dueDate) : undefined,
    boletoLine:
      input.boletoLine === undefined
        ? undefined
        : input.boletoLine?.replace(/\s+/g, ' ').trim() || null,
    boletoUrl: input.boletoUrl,
    notes: input.notes,
  };
}

export async function createInvoice(input: InvoiceInput, userId: string) {
  const created = await prisma.vendorInvoice.create({
    data: {
      ...toData(input),
      vendor: input.vendor,
      referenceMonth: parseIsoDate(`${input.referenceMonth}-01`),
      amount: input.amount,
      dueDate: parseIsoDate(input.dueDate),
      createdById: userId,
    },
  });
  await logAudit({
    userId,
    action: 'vendor_invoice.create',
    entityType: 'vendor_invoice',
    entityId: created.id,
    details: { vendor: input.vendor, amount: input.amount, dueDate: input.dueDate },
  });
  return toInvoiceDto(created, todayIsoDate());
}

async function requireInvoice(id: string) {
  const invoice = await prisma.vendorInvoice.findUnique({ where: { id } });
  if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Fatura não encontrada' });
  return invoice;
}

export async function updateInvoice(id: string, input: Partial<InvoiceInput>, userId: string) {
  await requireInvoice(id);
  const updated = await prisma.vendorInvoice.update({ where: { id }, data: toData(input) });
  await logAudit({
    userId,
    action: 'vendor_invoice.update',
    entityType: 'vendor_invoice',
    entityId: id,
    details: { fields: Object.keys(input) },
  });
  return toInvoiceDto(updated, todayIsoDate());
}

export async function setInvoiceStatus(
  id: string,
  status: VendorInvoiceStatus,
  userId: string,
  paidAt?: string,
) {
  await requireInvoice(id);
  const updated = await prisma.vendorInvoice.update({
    where: { id },
    data: {
      status,
      paidAt: status === 'pago' ? (paidAt ? parseIsoDate(paidAt) : new Date()) : null,
    },
  });
  await logAudit({
    userId,
    action: `vendor_invoice.${status}`,
    entityType: 'vendor_invoice',
    entityId: id,
  });
  return toInvoiceDto(updated, todayIsoDate());
}

export async function deleteInvoice(id: string, userId: string) {
  await requireInvoice(id);
  await prisma.vendorInvoice.delete({ where: { id } });
  await logAudit({
    userId,
    action: 'vendor_invoice.delete',
    entityType: 'vendor_invoice',
    entityId: id,
  });
  return { success: true };
}

export function vendorInvoiceObjectKey(id: string): string {
  return `vendor-invoices/${id}.pdf`;
}
