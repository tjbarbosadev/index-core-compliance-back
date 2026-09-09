export type SendTelegramResult = {
  sent: boolean;
  reason: 'skipped' | 'error' | 'sent';
};

/**
 * Envia mensagem via Telegram Bot API (sendMessage).
 * Sem token/chat → skipped sem fetch. Erros HTTP/rede → error sem throw.
 */
export async function sendTelegramMessage(input: {
  token?: string;
  chatId?: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<SendTelegramResult> {
  const token = input.token?.trim();
  const chatId = input.chatId?.trim();
  if (!token || !chatId) {
    console.warn('[telegram] token ou chat_id ausente — mensagem não enviada');
    return { sent: false, reason: 'skipped' };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: input.text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[telegram] HTTP error', { status: res.status, body: body.slice(0, 200) });
      return { sent: false, reason: 'error' };
    }
    console.info('[telegram] mensagem enviada', { chatId: maskChatId(chatId) });
    return { sent: true, reason: 'sent' };
  } catch (err) {
    console.error('[telegram] falha ao enviar:', err);
    return { sent: false, reason: 'error' };
  }
}

export function maskChatId(chatId: string): string {
  if (chatId.length <= 4) return '****';
  return `${chatId.slice(0, 2)}***${chatId.slice(-2)}`;
}
