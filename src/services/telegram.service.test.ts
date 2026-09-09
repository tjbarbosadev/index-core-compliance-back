import { describe, expect, it, vi } from 'vitest';
import { maskChatId, sendTelegramMessage } from './telegram.service.js';

describe('sendTelegramMessage', () => {
  it('T01: sem token → skipped sem fetch', async () => {
    const fetchImpl = vi.fn();
    const result = await sendTelegramMessage({
      chatId: '123',
      text: 'olá',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('T02: sem chat_id → skipped sem fetch', async () => {
    const fetchImpl = vi.fn();
    const result = await sendTelegramMessage({
      token: 'bot-token',
      text: 'olá',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'skipped' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('T03: token + chat → sent com fetch mockado', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}',
    });
    const result = await sendTelegramMessage({
      token: 'bot-token',
      chatId: '999',
      text: 'Amanhã há amortização',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: true, reason: 'sent' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe('999');
    expect(body.text).toBe('Amanhã há amortização');
    expect(body.disable_web_page_preview).toBe(true);
  });

  it('T04: HTTP 4xx/5xx → error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });
    const result = await sendTelegramMessage({
      token: 'bot-token',
      chatId: '999',
      text: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'error' });
  });

  it('T05: fetch rejeita → error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const result = await sendTelegramMessage({
      token: 'bot-token',
      chatId: '999',
      text: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ sent: false, reason: 'error' });
  });

  it('T07: texto com acentuação pt-BR no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    const text = 'Amanhã há amortização — posição Sênior I';
    await sendTelegramMessage({
      token: 't',
      chatId: '1',
      text,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.text).toBe(text);
  });
});

describe('maskChatId', () => {
  it('masks middle of chat id', () => {
    expect(maskChatId('123456789')).toBe('12***89');
  });
});
