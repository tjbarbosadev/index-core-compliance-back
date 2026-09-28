import { describe, expect, it } from 'vitest';
import type { VendorInvoice } from '@prisma/client';
import {
  daysBetween,
  displayStatus,
  summarizeInvoices,
  toInvoiceDto,
  todayIsoDate,
} from './vendor-billing.service.js';
import { buildVendorInvoiceAlertLines } from './vendor-invoice-alert.service.js';

function row(overrides: Partial<VendorInvoice>): VendorInvoice {
  return {
    id: 'inv-1',
    vendor: 'bigdatacorp',
    referenceMonth: new Date('2026-08-01T00:00:00Z'),
    description: null,
    amount: 100 as never,
    dueDate: new Date('2026-09-30T00:00:00Z'),
    status: 'pendente',
    boletoLine: null,
    boletoUrl: null,
    documentUri: null,
    documentName: null,
    notes: null,
    paidAt: null,
    createdById: null,
    createdAt: new Date('2026-09-01T12:00:00Z'),
    updatedAt: new Date('2026-09-01T12:00:00Z'),
    ...overrides,
  };
}

const today = '2026-09-28';

describe('vendor-billing.service', () => {
  it('todayIsoDate usa fuso de Brasília', () => {
    expect(todayIsoDate(new Date('2026-09-29T02:00:00Z'))).toBe('2026-09-28');
  });

  it('daysBetween conta dias corridos', () => {
    expect(daysBetween('2026-09-28', '2026-10-01')).toBe(3);
    expect(daysBetween('2026-09-28', '2026-09-20')).toBe(-8);
  });

  it('pendente com vencimento passado vira vencida', () => {
    expect(displayStatus(row({ dueDate: new Date('2026-09-27T00:00:00Z') }), today)).toBe(
      'vencida',
    );
    expect(displayStatus(row({ dueDate: new Date('2026-09-28T00:00:00Z') }), today)).toBe(
      'pendente',
    );
    expect(
      displayStatus(row({ status: 'pago', dueDate: new Date('2026-09-01T00:00:00Z') }), today),
    ).toBe('pago');
  });

  it('toInvoiceDto serializa datas e valor', () => {
    const dto = toInvoiceDto(row({ amount: '1234.56' as never, documentUri: 'local://x' }), today);
    expect(dto).toMatchObject({
      vendorLabel: 'BigDataCorp',
      referenceMonth: '2026-08',
      amount: 1234.56,
      dueDate: '2026-09-30',
      daysUntilDue: 2,
      hasDocument: true,
    });
  });

  it('summarizeInvoices agrupa vencidas, 7 e 30 dias', () => {
    const dtos = [
      row({ id: 'a', dueDate: new Date('2026-09-20T00:00:00Z'), amount: 50 as never }),
      row({ id: 'b', dueDate: new Date('2026-10-02T00:00:00Z'), amount: 100 as never }),
      row({ id: 'c', dueDate: new Date('2026-10-20T00:00:00Z'), amount: 200 as never }),
      row({
        id: 'd',
        status: 'pago',
        paidAt: new Date('2026-09-10T15:00:00Z'),
        amount: 70 as never,
      }),
      row({ id: 'e', status: 'cancelado', amount: 999 as never }),
    ].map((r) => toInvoiceDto(r, today));

    const summary = summarizeInvoices(dtos, today);
    expect(summary.overdue).toEqual({ count: 1, total: 50 });
    expect(summary.dueIn7Days).toEqual({ count: 1, total: 100 });
    expect(summary.dueIn30Days).toEqual({ count: 2, total: 300 });
    expect(summary.open).toEqual({ count: 3, total: 350 });
    expect(summary.paidThisMonth).toEqual({ count: 1, total: 70 });
  });
});

describe('buildVendorInvoiceAlertLines', () => {
  const dtos = [
    row({ id: 'late', dueDate: new Date('2026-09-25T00:00:00Z') }),
    row({ id: 'd3', dueDate: new Date('2026-10-01T00:00:00Z') }),
    row({ id: 'd5', dueDate: new Date('2026-10-03T00:00:00Z') }),
    row({ id: 'today', vendor: 'lemit', dueDate: new Date('2026-09-28T00:00:00Z') }),
  ].map((r) => toInvoiceDto(r, today));

  it('avisa vencidas, D-3 e hoje; ignora D-5', () => {
    const lines = buildVendorInvoiceAlertLines(dtos, [], 3);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^VENCIDA há 3 dia/);
    expect(lines.some((l) => l.startsWith('Vence em 3 dia'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Vence HOJE: Lemit'))).toBe(true);
  });

  it('inclui provedor com pagamento pendente', () => {
    const lines = buildVendorInvoiceAlertLines(
      [],
      [
        {
          vendor: 'apollo',
          name: 'Apollo.io',
          status: 'payment_issue',
          statusMessage: 'There is an issue with your payment.',
        } as never,
        { vendor: 'lemit', name: 'Lemit', status: 'ok', statusMessage: null } as never,
      ],
      3,
    );
    expect(lines).toEqual(['Apollo.io: There is an issue with your payment.']);
  });
});
