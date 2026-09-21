import { describe, expect, it, vi } from 'vitest';
import {
  hasOpenWaDestination,
  maskPhone,
  normalizeBrazilWaPhone,
  parseWhatsappDestinations,
  sendWhatsappMessage,
  toWhatsAppChatId,
} from './whatsapp.service.js';

describe('normalizeBrazilWaPhone / toWhatsAppChatId', () => {
  it('normaliza celular BR com DDD', () => {
    expect(normalizeBrazilWaPhone('(11) 98765-4321')).toBe('5511987654321');
    expect(toWhatsAppChatId('11987654321')).toBe('5511987654321@c.us');
  });

  it('aceita E.164 já com 55', () => {
    expect(normalizeBrazilWaPhone('+55 11 98765-4321')).toBe('5511987654321');
  });

  it('W02: número inválido → null (sem throw)', () => {
    expect(normalizeBrazilWaPhone('123')).toBeNull();
    expect(toWhatsAppChatId('abc')).toBeNull();
  });
});

describe('parseWhatsappDestinations', () => {
  it('parseia lista por vírgula e deduplica', () => {
    expect(parseWhatsappDestinations('11987654321, 5511888888888;11987654321')).toEqual([
      '5511987654321',
      '5511888888888',
    ]);
  });

  it('ignora inválidos e string vazia', () => {
    expect(parseWhatsappDestinations('')).toEqual([]);
    expect(parseWhatsappDestinations('xx, 11987654321')).toEqual(['5511987654321']);
  });
});

describe('hasOpenWaDestination', () => {
  it('exige baseUrl, apiKey, session e destino válido', () => {
    expect(
      hasOpenWaDestination({
        baseUrl: 'http://crm_openwa:2785',
        apiKey: 'key',
        sessionId: 'sess',
        to: '11987654321',
      }),
    ).toBe(true);
    expect(
      hasOpenWaDestination({
        baseUrl: 'http://x',
        apiKey: 'key',
        sessionId: 'sess',
        to: 'bad',
      }),
    ).toBe(false);
  });
});

describe('sendWhatsappMessage', () => {
  it('W01: sem credencial/destino → skipped sem fetch', async () => {
    const fetchImpl = vi.fn();
    const result = await sendWhatsappMessage({
      text: 'olá',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('W02: número inválido → skipped sem fetch', async () => {
    const fetchImpl = vi.fn();
    const result = await sendWhatsappMessage({
      baseUrl: 'http://crm_openwa:2785',
      apiKey: 'key',
      sessionId: 'sess-1',
      to: '123',
      text: 'olá',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('W03: OpenWA ok → sent com fetch mockado', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}',
    });
    const result = await sendWhatsappMessage({
      baseUrl: 'http://crm_openwa:2785',
      apiKey: 'secret-key',
      sessionId: 'sess-1',
      to: '11987654321',
      text: 'Amanhã há amortização',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: true, reason: 'sent' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://crm_openwa:2785/api/sessions/sess-1/messages/send-text');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('secret-key');
    const body = JSON.parse(String(init.body));
    expect(body.chatId).toBe('5511987654321@c.us');
    expect(body.text).toBe('Amanhã há amortização');
  });

  it('W04: API HTTP error → error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    });
    const result = await sendWhatsappMessage({
      baseUrl: 'http://crm_openwa:2785',
      apiKey: 'key',
      sessionId: 'sess-1',
      to: '11987654321',
      text: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'error' });
  });

  it('fetch rejeita → error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const result = await sendWhatsappMessage({
      baseUrl: 'http://crm_openwa:2785',
      apiKey: 'key',
      sessionId: 'sess-1',
      to: '11987654321',
      text: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'error' });
  });
});

describe('maskPhone', () => {
  it('mascara meio do telefone', () => {
    expect(maskPhone('5511987654321')).toBe('55***21');
  });
});
