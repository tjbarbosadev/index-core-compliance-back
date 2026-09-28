import { env } from '../lib/env.js';
import { complianceApiClient } from '../lib/compliance/client.js';
import type { ProviderBillingCard } from '../lib/compliance/types.js';
import { sendVendorInvoiceAlertEmail } from './email.service.js';
import { sendTelegramMessage } from './telegram.service.js';
import { listInvoices, type VendorInvoiceDto } from './vendor-billing.service.js';

const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const brDate = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Linhas do aviso: faturas vencidas (todo dia), vencendo em `daysAhead`, amanhã ou hoje,
 * e provedores com pagamento pendente / saldo baixo.
 */
export function buildVendorInvoiceAlertLines(
  invoices: VendorInvoiceDto[],
  providers: ProviderBillingCard[],
  daysAhead: number,
): string[] {
  const lines: string[] = [];
  const reminderDays = new Set([daysAhead, 1, 0]);

  for (const invoice of invoices) {
    const label = `${invoice.vendorLabel} ${invoice.referenceMonth} — ${brl(invoice.amount)}`;
    if (invoice.status === 'vencida') {
      lines.push(
        `VENCIDA há ${Math.abs(invoice.daysUntilDue)} dia(s): ${label} (venc. ${brDate(invoice.dueDate)})`,
      );
    } else if (invoice.status === 'pendente' && reminderDays.has(invoice.daysUntilDue)) {
      const when = invoice.daysUntilDue === 0 ? 'HOJE' : `em ${invoice.daysUntilDue} dia(s)`;
      lines.push(`Vence ${when}: ${label} (venc. ${brDate(invoice.dueDate)})`);
    }
  }

  for (const card of providers) {
    if (card.status === 'payment_issue' || card.status === 'low_balance') {
      lines.push(`${card.name}: ${card.statusMessage ?? card.status}`);
    }
  }

  return lines;
}

export async function runVendorInvoiceAlertJob(): Promise<{ sent: boolean; lines: number }> {
  if (!env.vendorInvoiceAlertEnabled) return { sent: false, lines: 0 };

  const invoices = await listInvoices();
  const providers = await complianceApiClient
    .getProviderBilling()
    .then((overview) => overview.providers)
    .catch((err: unknown) => {
      console.warn('[job] vendor-invoice-alert: hub de compliance indisponível', err);
      return [] as ProviderBillingCard[];
    });

  const lines = buildVendorInvoiceAlertLines(invoices, providers, env.vendorInvoiceAlertDays);
  if (lines.length === 0) return { sent: false, lines: 0 };

  const adminUrl = `${env.webUrl.replace(/\/$/, '')}/admin/custos`;
  const subject = `OpCore — ${lines.length} aviso(s) de cobrança de APIs pagas`;

  await Promise.all(
    env.vendorInvoiceAlertEmails.map((to) =>
      sendVendorInvoiceAlertEmail({ to, subject, lines, adminUrl }),
    ),
  );
  await sendTelegramMessage({
    token: env.telegramBotToken,
    chatId: env.vendorInvoiceAlertTelegramChatId,
    text: [subject, '', ...lines.map((l) => `• ${l}`), '', adminUrl].join('\n'),
  });

  console.log(`[job] vendor-invoice-alert enviado lines=${lines.length}`);
  return { sent: true, lines: lines.length };
}
