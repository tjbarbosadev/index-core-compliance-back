export type SendWhatsappResult = {
  sent: boolean;
  reason: 'skipped' | 'error' | 'sent';
};

/**
 * Digitos E.164 BR sem +: 55 + DDD + número (10–11 dígitos locais).
 * Aceita entrada com/sem +, espaços, hífens; rejeita inválidos.
 */
export function normalizeBrazilWaPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 10) return null;
  if (!digits.startsWith('55') && digits.length <= 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

/** Converte telefone em chatId OpenWA (`5511...@c.us`). */
export function toWhatsAppChatId(phone: string): string | null {
  const digits = normalizeBrazilWaPhone(phone);
  if (!digits) return null;
  return `${digits}@c.us`;
}

/**
 * Lista separada por vírgula/ponto-e-vírgula → destinos únicos normalizados.
 * Entradas inválidas são ignoradas (não lançam).
 */
export function parseWhatsappDestinations(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const normalized = normalizeBrazilWaPhone(part.trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function hasOpenWaDestination(input: {
  baseUrl?: string | null;
  apiKey?: string | null;
  sessionId?: string | null;
  to?: string | null;
}): boolean {
  return Boolean(
    input.baseUrl?.trim() &&
    input.apiKey?.trim() &&
    input.sessionId?.trim() &&
    input.to?.trim() &&
    normalizeBrazilWaPhone(input.to),
  );
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 2)}***${digits.slice(-2)}`;
}

function normalizeOpenWaBaseUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    let path = url.pathname.replace(/\/+$/, '');
    if (path.toLowerCase() === '/api') path = '';
    return `${url.protocol}//${url.host}${path}`.replace(/\/+$/, '');
  } catch {
    return value.replace(/\/+$/, '').replace(/\/api$/i, '');
  }
}

type OpenWaSessionDto = {
  id?: string;
  sessionId?: string;
  name?: string;
  status?: string;
};

function sessionIdOf(row: OpenWaSessionDto): string {
  return String(row.id || row.sessionId || '');
}

/**
 * Resolve session id: OPENWA_SESSION_ID direto, ou busca por OPENWA_SESSION_NAME.
 */
export async function resolveOpenWaSessionId(input: {
  baseUrl: string;
  apiKey: string;
  sessionId?: string | null;
  sessionName?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const explicit = input.sessionId?.trim();
  if (explicit) return explicit;

  const name = input.sessionName?.trim();
  if (!name) return null;

  const base = normalizeOpenWaBaseUrl(input.baseUrl);
  const fetchFn = input.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(`${base}/api/sessions?limit=100&offset=0`, {
      method: 'GET',
      headers: {
        'X-API-Key': input.apiKey.trim(),
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const parsed: unknown = await res.json().catch(() => null);
    let list: OpenWaSessionDto[] = [];
    if (Array.isArray(parsed)) {
      list = parsed as OpenWaSessionDto[];
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      for (const key of ['data', 'items', 'sessions', 'results']) {
        if (Array.isArray(obj[key])) {
          list = obj[key] as OpenWaSessionDto[];
          break;
        }
      }
    }
    const match = list.find((s) => s.name === name);
    const id = match ? sessionIdOf(match) : '';
    return id || null;
  } catch {
    return null;
  }
}

/**
 * Envia texto via OpenWA (POST /api/sessions/{id}/messages/send-text).
 * Sem credencial/destino válido → skipped sem fetch. Erros → error sem throw.
 */
export async function sendWhatsappMessage(input: {
  baseUrl?: string;
  apiKey?: string;
  sessionId?: string;
  to?: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<SendWhatsappResult> {
  const baseUrl = input.baseUrl?.trim();
  const apiKey = input.apiKey?.trim();
  const sessionId = input.sessionId?.trim();
  const chatId = input.to ? toWhatsAppChatId(input.to) : null;

  if (!baseUrl || !apiKey || !sessionId || !chatId) {
    console.warn('[whatsapp] OpenWA ou destino ausente/inválido — mensagem não enviada');
    return { sent: false, reason: 'skipped' };
  }

  const base = normalizeOpenWaBaseUrl(baseUrl);
  const fetchFn = input.fetchImpl ?? fetch;
  const url = `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages/send-text`;

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chatId, text: input.text }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[whatsapp] HTTP error', { status: res.status, body: body.slice(0, 200) });
      return { sent: false, reason: 'error' };
    }
    console.info('[whatsapp] mensagem enviada', { to: maskPhone(input.to ?? '') });
    return { sent: true, reason: 'sent' };
  } catch (err) {
    console.error('[whatsapp] falha ao enviar:', err);
    return { sent: false, reason: 'error' };
  }
}
