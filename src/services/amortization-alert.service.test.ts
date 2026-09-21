import { describe, expect, it, vi } from 'vitest';
import {
  buildAmortizationAlertMessage,
  filterEligibleAmortizationLinks,
  formatDatePtBr,
  hasTelegramDestination,
  runAmortizationAlertJob,
  type AmortizationAlertLink,
} from './amortization-alert.service.js';
import { addDays, parseYYYYMMDD, toYYYYMMDD } from './quota-calculator.js';

const TARGET = '2026-01-31'; // +30 from 2026-01-01
const NOW = new Date('2026-01-30T15:00:00Z'); // BRT ~12:00 → amanhã 2026-01-31
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function link(overrides: Partial<AmortizationAlertLink> & { id: string }): AmortizationAlertLink {
  return {
    quotaType: 'senior_i',
    contractStartDate: parseYYYYMMDD('2026-01-01'),
    contractEndDate: null,
    party: { legalName: 'Cotista Teste' },
    fund: { name: 'Fundo Teste' },
    ...overrides,
  };
}

describe('filterEligibleAmortizationLinks', () => {
  it('E01: empty list yields empty', () => {
    expect(filterEligibleAmortizationLinks([], TARGET)).toEqual([]);
  });

  it('E02: senior_ii only yields empty', () => {
    const links = [link({ id: '1', quotaType: 'senior_ii' })];
    expect(filterEligibleAmortizationLinks(links, TARGET)).toEqual([]);
  });

  it('E03: senior_i but target is not amortization day', () => {
    const links = [link({ id: '1' })];
    expect(filterEligibleAmortizationLinks(links, '2026-01-30')).toEqual([]);
  });

  it('E04: one senior_i eligible on target', () => {
    const links = [link({ id: '1' })];
    expect(filterEligibleAmortizationLinks(links, TARGET)).toHaveLength(1);
  });

  it('E05: multiple positions same party all eligible', () => {
    const links = [
      link({ id: '1', party: { legalName: 'Mesmo CPF' }, fund: { name: 'Fundo A' } }),
      link({ id: '2', party: { legalName: 'Mesmo CPF' }, fund: { name: 'Fundo B' } }),
    ];
    expect(filterEligibleAmortizationLinks(links, TARGET)).toHaveLength(2);
  });

  it('E06: mix eligible I + II + non-eligible I', () => {
    const links = [
      link({ id: 'ok', quotaType: 'senior_i' }),
      link({ id: 'ii', quotaType: 'senior_ii' }),
      link({
        id: 'late',
        contractStartDate: parseYYYYMMDD('2026-01-15'),
      }),
    ];
    const result = filterEligibleAmortizationLinks(links, TARGET);
    expect(result.map((l) => l.id)).toEqual(['ok']);
  });

  it('E07: contract ended before target is excluded', () => {
    const links = [
      link({
        id: 'ended',
        contractEndDate: parseYYYYMMDD('2026-01-30'),
      }),
    ];
    expect(filterEligibleAmortizationLinks(links, TARGET)).toEqual([]);
  });

  it('E08: contract ending on target is included', () => {
    const links = [
      link({
        id: 'ends-tomorrow',
        contractEndDate: parseYYYYMMDD(TARGET),
      }),
    ];
    expect(filterEligibleAmortizationLinks(links, TARGET)).toHaveLength(1);
  });

  it('E09: link without contact still eligible (admin alert)', () => {
    const links = [link({ id: '1', party: { legalName: 'Sem Contato' } })];
    expect(filterEligibleAmortizationLinks(links, TARGET)).toHaveLength(1);
  });

  it('E10: legacy senior quota treated as senior_i', () => {
    const links = [
      link({ id: 'legacy', quotaType: 'senior' }),
      link({ id: 'ii', quotaType: 'senior_ii' }),
    ];
    const result = filterEligibleAmortizationLinks(links, TARGET);
    expect(result.map((l) => l.id)).toEqual(['legacy']);
  });

  it('skips links without contractStartDate', () => {
    const links = [link({ id: '1', contractStartDate: null })];
    expect(filterEligibleAmortizationLinks(links, TARGET)).toEqual([]);
  });
});

describe('hasTelegramDestination', () => {
  it('requires both token and chat id', () => {
    expect(hasTelegramDestination(undefined, undefined)).toBe(false);
    expect(hasTelegramDestination('tok', undefined)).toBe(false);
    expect(hasTelegramDestination(undefined, '123')).toBe(false);
    expect(hasTelegramDestination('', '123')).toBe(false);
    expect(hasTelegramDestination('tok', '123')).toBe(true);
  });
});

describe('buildAmortizationAlertMessage', () => {
  it('C01/C03: pt-BR singular and plural', () => {
    const one = buildAmortizationAlertMessage([link({ id: '1' })], TARGET);
    expect(one).toContain('1 posição');
    expect(one).toContain('Amanhã (31/01/2026)');
    expect(one).toContain('Acesse Cotistas no OpCore');

    const two = buildAmortizationAlertMessage(
      [link({ id: '1' }), link({ id: '2', party: { legalName: 'Outro' }, fund: { name: 'B' } })],
      TARGET,
    );
    expect(two).toContain('2 posições');
  });

  it('C01 today: uses Hoje headline', () => {
    const msg = buildAmortizationAlertMessage([link({ id: '1' })], TARGET, { when: 'today' });
    expect(msg).toContain('Hoje (31/01/2026)');
    expect(msg).not.toContain('Amanhã');
  });

  it('C02: does not expose UUIDs or partyFundLinkId', () => {
    const msg = buildAmortizationAlertMessage(
      [link({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })],
      TARGET,
    );
    expect(msg).not.toMatch(UUID_RE);
    expect(msg).not.toContain('partyFundLinkId');
  });

  it('C04: truncates list after 15 lines', () => {
    const links = Array.from({ length: 17 }, (_, i) =>
      link({
        id: String(i),
        party: { legalName: `Cotista ${i}` },
        fund: { name: `Fundo ${i}` },
      }),
    );
    const msg = buildAmortizationAlertMessage(links, TARGET);
    expect(msg).toContain('e mais 2');
    expect(msg.split('\n').filter((l) => l.startsWith('- Cotista')).length).toBe(15);
  });

  it('C05: unicode names preserved', () => {
    const msg = buildAmortizationAlertMessage(
      [link({ id: '1', party: { legalName: 'José Açúcar' }, fund: { name: 'FIDC São Paulo' } })],
      TARGET,
    );
    expect(msg).toContain('José Açúcar / FIDC São Paulo');
  });

  it('formatDatePtBr converts ISO date', () => {
    expect(formatDatePtBr('2026-01-31')).toBe('31/01/2026');
  });
});

describe('runAmortizationAlertJob', () => {
  it('J01: enabled false skips without calling findLinks', async () => {
    const findLinks = vi.fn(async () => [link({ id: '1' })]);
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: false,
      findLinks,
    });
    expect(findLinks).not.toHaveBeenCalled();
    expect(result).toEqual({
      targetDate: TARGET,
      slot: 'd1_am',
      count: 0,
      skipped: true,
      reason: 'disabled',
    });
  });

  it('T08: count 0 does not call sendTelegram', async () => {
    const sendTelegram = vi.fn();
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: 'tok',
      telegramChatId: '123',
      findLinks: async () => [link({ id: '1', quotaType: 'senior_ii' })],
      sendTelegram,
    });
    expect(result.count).toBe(0);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it('returns telegram_skipped when eligible but missing token/chat', async () => {
    const sendTelegram = vi.fn();
    const recordDelivery = vi.fn();
    const findDelivery = vi.fn();
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      whatsappTo: '',
      findLinks: async () => [link({ id: '1' })],
      sendTelegram,
      findDelivery,
      recordDelivery,
    });
    expect(result.reason).toBe('telegram_skipped');
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(findDelivery).not.toHaveBeenCalled();
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  it('I01: sends once and records delivery', async () => {
    const sendTelegram = vi.fn().mockResolvedValue({ sent: true, reason: 'sent' });
    const findDelivery = vi.fn().mockResolvedValue(false);
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: 'tok',
      telegramChatId: '123',
      whatsappTo: '',
      findLinks: async () => [link({ id: '1' })],
      sendTelegram,
      findDelivery,
      recordDelivery,
    });
    expect(result.reason).toBe('ok');
    expect(sendTelegram).toHaveBeenCalledOnce();
    expect(recordDelivery).toHaveBeenCalledWith(TARGET, 'telegram', '', 'd1_am');
    const payload = sendTelegram.mock.calls[0]![0] as { text: string };
    expect(payload.text).toContain('Cotista Teste / Fundo Teste');
    expect(payload.text).not.toMatch(UUID_RE);
  });

  it('I02: already_sent skips send', async () => {
    const sendTelegram = vi.fn();
    const recordDelivery = vi.fn();
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: 'tok',
      telegramChatId: '123',
      whatsappTo: '',
      findLinks: async () => [link({ id: '1' })],
      sendTelegram,
      findDelivery: async () => true,
      recordDelivery,
    });
    expect(result.reason).toBe('already_sent');
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  it('I05: send error does not record delivery', async () => {
    const sendTelegram = vi.fn().mockResolvedValue({ sent: false, reason: 'error' });
    const recordDelivery = vi.fn();
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: 'tok',
      telegramChatId: '123',
      whatsappTo: '',
      findLinks: async () => [link({ id: '1' })],
      sendTelegram,
      findDelivery: async () => false,
      recordDelivery,
    });
    expect(result.reason).toBe('telegram_error');
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  it('J05: telegram already sent still allows whatsapp', async () => {
    const sendTelegram = vi.fn();
    const sendWhatsapp = vi.fn().mockResolvedValue({ sent: true, reason: 'sent' });
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    const findDelivery = vi.fn(async (_ref: string, channel: string) => channel === 'telegram');
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: 'tok',
      telegramChatId: '123',
      openWaBaseUrl: 'http://crm_openwa:2785',
      openWaApiKey: 'key',
      openWaSessionId: 'sess-1',
      whatsappTo: '11987654321',
      findLinks: async () => [link({ id: '1' })],
      sendTelegram,
      sendWhatsapp,
      findDelivery,
      recordDelivery,
    });
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(sendWhatsapp).toHaveBeenCalledOnce();
    expect(recordDelivery).toHaveBeenCalledWith(TARGET, 'whatsapp', '5511987654321', 'd1_am');
    expect(result.channels?.some((c) => c.channel === 'whatsapp' && c.reason === 'sent')).toBe(
      true,
    );
  });

  it('I03: whatsapp per destination — one fail does not block other', async () => {
    const sendWhatsapp = vi
      .fn()
      .mockResolvedValueOnce({ sent: true, reason: 'sent' })
      .mockResolvedValueOnce({ sent: false, reason: 'error' });
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      openWaBaseUrl: 'http://crm_openwa:2785',
      openWaApiKey: 'key',
      openWaSessionId: 'sess-1',
      whatsappTo: '11987654321,11888888888',
      findLinks: async () => [link({ id: '1' })],
      sendTelegram: async () => ({ sent: false, reason: 'skipped' }),
      sendWhatsapp,
      findDelivery: async () => false,
      recordDelivery,
    });
    expect(sendWhatsapp).toHaveBeenCalledTimes(2);
    expect(recordDelivery).toHaveBeenCalledOnce();
    expect(recordDelivery).toHaveBeenCalledWith(TARGET, 'whatsapp', '5511987654321', 'd1_am');
    // Partial success → overall ok; failed destination not recorded (retry next run)
    expect(result.reason).toBe('ok');
    expect(result.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'whatsapp',
          destination: '5511987654321',
          reason: 'sent',
        }),
        expect.objectContaining({
          channel: 'whatsapp',
          destination: '5511888888888',
          reason: 'error',
        }),
      ]),
    );
  });

  it('I05 whatsapp: skip by missing config does not record sent', async () => {
    const recordDelivery = vi.fn();
    const sendWhatsapp = vi.fn();
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      whatsappTo: '11987654321',
      openWaBaseUrl: '',
      openWaApiKey: '',
      findLinks: async () => [link({ id: '1' })],
      sendWhatsapp,
      findDelivery: async () => false,
      recordDelivery,
    });
    expect(sendWhatsapp).not.toHaveBeenCalled();
    expect(recordDelivery).not.toHaveBeenCalled();
    expect(result.channels?.every((c) => c.reason === 'skipped')).toBe(true);
  });

  it('sends whatsapp to both Johny and Bruno with same text', async () => {
    const sendWhatsapp = vi.fn().mockResolvedValue({ sent: true, reason: 'sent' });
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      openWaBaseUrl: 'http://crm_openwa:2785',
      openWaApiKey: 'key',
      openWaSessionId: 'sess-1',
      whatsappTo: '11911111111,11922222222',
      findLinks: async () => [link({ id: '1' })],
      sendWhatsapp,
      findDelivery: async () => false,
      recordDelivery,
    });
    expect(sendWhatsapp).toHaveBeenCalledTimes(2);
    const texts = sendWhatsapp.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).toContain('Cotista Teste');
  });

  it('returns count for eligible links with injected now and findLinks', async () => {
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      findLinks: async () => [link({ id: '1' })],
      findDelivery: async () => false,
      sendTelegram: async () => ({ sent: false, reason: 'skipped' }),
    });
    expect(result.targetDate).toBe(TARGET);
    expect(result.count).toBe(1);
  });

  it('returns count 0 when none eligible', async () => {
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      findLinks: async () => [link({ id: '1', quotaType: 'senior_ii' })],
    });
    expect(result.targetDate).toBe(TARGET);
    expect(result.count).toBe(0);
    expect(result.reason).toBe('ok');
  });

  it('swallows findLinks errors and returns count 0', async () => {
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      findLinks: async () => {
        throw new Error('db down');
      },
    });
    expect(result.targetDate).toBe(TARGET);
    expect(result.count).toBe(0);
  });

  it('uses tomorrow relative to injected now', async () => {
    const start = parseYYYYMMDD('2025-12-02');
    const target = toYYYYMMDD(addDays(start, 30));
    const now = new Date('2025-12-31T15:00:00Z');
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      findLinks: async () => [
        link({
          id: 'year-boundary',
          contractStartDate: start,
        }),
      ],
    });
    expect(result.targetDate).toBe(target);
    expect(result.count).toBe(1);
  });

  it('does not throw when findLinks rejects (defensive for daily)', async () => {
    await expect(
      runAmortizationAlertJob({
        readyPhones: [],
        now: NOW,
        enabled: true,
        findLinks: () => Promise.reject(new Error('boom')),
      }),
    ).resolves.toMatchObject({ targetDate: TARGET, count: 0 });
  });
});

describe('runAmortizationAlertJob logging', () => {
  it('logs summary without technical ids', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      findLinks: async () => [
        link({
          id: 'uuid-should-not-appear',
          party: { legalName: 'Maria Silva' },
          fund: { name: 'FIDC Alpha' },
        }),
      ],
      sendTelegram: async () => ({ sent: false, reason: 'skipped' }),
      findDelivery: async () => false,
    });
    const joined = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toContain('amortization-alert');
    expect(joined).toContain('Maria Silva / FIDC Alpha');
    expect(joined).not.toContain('uuid-should-not-appear');
    spy.mockRestore();
  });

  it('logs disabled when flag off', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAmortizationAlertJob({ readyPhones: [], now: NOW, enabled: false });
    const joined = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(joined).toContain('reason=disabled');
    spy.mockRestore();
  });
});

describe('amortization alert slots', () => {
  it('d0_am uses today as targetDate and Hoje message', async () => {
    const sendTelegram = vi.fn().mockResolvedValue({ sent: true, reason: 'sent' });
    const recordDelivery = vi.fn().mockResolvedValue(undefined);
    // NOW is 2026-01-30 BRT afternoon → today 2026-01-30; need due on that day
    const dueToday = '2026-01-30';
    const start = parseYYYYMMDD('2025-12-31'); // +30 = 2026-01-30
    const result = await runAmortizationAlertJob({
      readyPhones: [],
      now: NOW,
      slot: 'd0_am',
      enabled: true,
      telegramBotToken: 'tok',
      telegramChatId: '123',
      whatsappTo: '',
      findLinks: async () => [link({ id: '1', contractStartDate: start })],
      sendTelegram,
      findDelivery: async () => false,
      recordDelivery,
    });
    expect(result.targetDate).toBe(dueToday);
    expect(result.slot).toBe('d0_am');
    expect(sendTelegram.mock.calls[0]![0].text).toContain('Hoje (30/01/2026)');
    expect(recordDelivery).toHaveBeenCalledWith(dueToday, 'telegram', '', 'd0_am');
  });

  it('same destination different slots both send', async () => {
    const sendWhatsapp = vi.fn().mockResolvedValue({ sent: true, reason: 'sent' });
    const sentSlots = new Set<string>();
    const findDelivery = vi.fn(async (_r, _c, _d, slot: string) => sentSlots.has(slot));
    const recordDelivery = vi.fn(async (_r, _c, _d, slot: string) => {
      sentSlots.add(slot);
    });
    const base = {
      readyPhones: ['5511999999999'],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      openWaBaseUrl: 'http://crm_openwa:2785',
      openWaApiKey: 'key',
      openWaSessionId: 'sess-1',
      whatsappTo: '',
      findLinks: async () => [link({ id: '1' })],
      sendWhatsapp,
      findDelivery,
      recordDelivery,
    };
    await runAmortizationAlertJob({ ...base, slot: 'd1_am' });
    await runAmortizationAlertJob({ ...base, slot: 'd1_pm' });
    expect(sendWhatsapp).toHaveBeenCalledTimes(2);
    expect(recordDelivery).toHaveBeenCalledWith(TARGET, 'whatsapp', '5511999999999', 'd1_am');
    expect(recordDelivery).toHaveBeenCalledWith(TARGET, 'whatsapp', '5511999999999', 'd1_pm');
  });

  it('ready session phones receive without env list', async () => {
    const sendWhatsapp = vi.fn().mockResolvedValue({ sent: true, reason: 'sent' });
    await runAmortizationAlertJob({
      readyPhones: ['5511970547356'],
      now: NOW,
      enabled: true,
      telegramBotToken: '',
      telegramChatId: '',
      openWaBaseUrl: 'http://crm_openwa:2785',
      openWaApiKey: 'key',
      openWaSessionId: 'sess-1',
      whatsappTo: '',
      findLinks: async () => [link({ id: '1' })],
      sendWhatsapp,
      findDelivery: async () => false,
      recordDelivery: async () => undefined,
    });
    expect(sendWhatsapp).toHaveBeenCalledOnce();
    expect(sendWhatsapp.mock.calls[0]![0].to).toBe('5511970547356');
  });
});
