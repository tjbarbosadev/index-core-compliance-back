export type SendWhatsappResult = {
  sent: boolean;
  reason: 'skipped' | 'error' | 'sent';
};

export type OpenWaSessionInfo = {
  id: string;
  name: string | null;
  status: string | null;
  phone: string | null;
};

export type OpenWaConfigInput = {
  baseUrl?: string | null;
  apiKey?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
  fetchImpl?: typeof fetch;
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

export function isOpenWaConfigured(input: {
  baseUrl?: string | null;
  apiKey?: string | null;
}): boolean {
  return Boolean(input.baseUrl?.trim() && input.apiKey?.trim());
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
  phoneNumber?: string;
  phone?: string;
};

function sessionIdOf(row: OpenWaSessionDto): string {
  return String(row.id || row.sessionId || '');
}

function mapSession(row: OpenWaSessionDto): OpenWaSessionInfo {
  return {
    id: sessionIdOf(row),
    name: row.name?.trim() || null,
    status: row.status?.trim() || null,
    phone: (row.phoneNumber || row.phone || null)?.toString().trim() || null,
  };
}

function openWaHeaders(apiKey: string, withJson = false): Record<string, string> {
  return {
    'X-API-Key': apiKey.trim(),
    Accept: 'application/json',
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
  };
}

function parseSessionList(parsed: unknown): OpenWaSessionDto[] {
  if (Array.isArray(parsed)) return parsed as OpenWaSessionDto[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['data', 'items', 'sessions', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as OpenWaSessionDto[];
    }
  }
  return [];
}

async function openWaJson<T>(input: {
  baseUrl: string;
  apiKey: string;
  method: string;
  path: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const base = normalizeOpenWaBaseUrl(input.baseUrl);
  const fetchFn = input.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(`${base}${input.path}`, {
      method: input.method,
      headers: openWaHeaders(input.apiKey, input.body !== undefined),
      body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text().catch(() => '');
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('[whatsapp] request falhou', input.path, err);
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Resolve session id: OPENWA_SESSION_ID direto, ou busca por OPENWA_SESSION_NAME.
 */
export async function resolveOpenWaSessionId(input: OpenWaConfigInput): Promise<string | null> {
  const explicit = input.sessionId?.trim();
  if (explicit) return explicit;

  const name = input.sessionName?.trim();
  if (!name) return null;
  if (!isOpenWaConfigured(input)) return null;

  const listed = await listOpenWaSessions(input);
  const match = listed.find((s) => s.name === name);
  return match?.id || null;
}

export async function listOpenWaSessions(input: OpenWaConfigInput): Promise<OpenWaSessionInfo[]> {
  if (!isOpenWaConfigured(input)) return [];
  const res = await openWaJson<unknown>({
    baseUrl: input.baseUrl!,
    apiKey: input.apiKey!,
    method: 'GET',
    path: '/api/sessions?limit=100&offset=0',
    fetchImpl: input.fetchImpl,
  });
  if (!res.ok) return [];
  return parseSessionList(res.data)
    .map(mapSession)
    .filter((s) => Boolean(s.id));
}

/** Cria sessão se não existir; faz start; devolve status atual. */
export async function ensureAlertSession(
  input: OpenWaConfigInput,
): Promise<OpenWaSessionInfo | null> {
  if (!isOpenWaConfigured(input)) return null;

  const name = input.sessionName?.trim() || 'opcore-alerts';
  let id = input.sessionId?.trim() || (await resolveOpenWaSessionId(input));

  if (!id) {
    const created = await openWaJson<OpenWaSessionDto>({
      baseUrl: input.baseUrl!,
      apiKey: input.apiKey!,
      method: 'POST',
      path: '/api/sessions',
      body: { name },
      fetchImpl: input.fetchImpl,
    });
    id = created.data ? sessionIdOf(created.data) : '';
    if (!id) {
      const listed = await listOpenWaSessions(input);
      id = listed.find((s) => s.name === name)?.id || '';
    }
  }
  if (!id) return null;

  await openWaJson({
    baseUrl: input.baseUrl!,
    apiKey: input.apiKey!,
    method: 'POST',
    path: `/api/sessions/${encodeURIComponent(id)}/start`,
    fetchImpl: input.fetchImpl,
  });

  return getSessionStatus({ ...input, sessionId: id });
}

export async function getSessionStatus(
  input: OpenWaConfigInput,
): Promise<OpenWaSessionInfo | null> {
  if (!isOpenWaConfigured(input)) return null;
  let id = input.sessionId?.trim() || null;
  if (!id) id = await resolveOpenWaSessionId(input);
  if (!id) return null;

  const res = await openWaJson<OpenWaSessionDto>({
    baseUrl: input.baseUrl!,
    apiKey: input.apiKey!,
    method: 'GET',
    path: `/api/sessions/${encodeURIComponent(id)}`,
    fetchImpl: input.fetchImpl,
  });
  if (!res.ok || !res.data) {
    return { id, name: input.sessionName ?? null, status: null, phone: null };
  }
  const mapped = mapSession(res.data);
  return { ...mapped, id: mapped.id || id };
}

/** Retorna data URL do QR (ou string QR) se disponível. */
export async function getSessionQr(input: OpenWaConfigInput): Promise<string | null> {
  if (!isOpenWaConfigured(input)) return null;
  let id = input.sessionId?.trim() || null;
  if (!id) id = await resolveOpenWaSessionId(input);
  if (!id) return null;

  const res = await openWaJson<Record<string, unknown>>({
    baseUrl: input.baseUrl!,
    apiKey: input.apiKey!,
    method: 'GET',
    path: `/api/sessions/${encodeURIComponent(id)}/qr`,
    fetchImpl: input.fetchImpl,
  });
  if (!res.ok || !res.data) return null;
  for (const key of ['qr', 'qrDataUrl', 'dataUrl', 'image', 'qrCode']) {
    const value = res.data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export async function logoutSession(input: OpenWaConfigInput): Promise<boolean> {
  if (!isOpenWaConfigured(input)) return false;
  let id = input.sessionId?.trim() || null;
  if (!id) id = await resolveOpenWaSessionId(input);
  if (!id) return false;

  const res = await openWaJson({
    baseUrl: input.baseUrl!,
    apiKey: input.apiKey!,
    method: 'POST',
    path: `/api/sessions/${encodeURIComponent(id)}/logout`,
    fetchImpl: input.fetchImpl,
  });
  return res.ok || res.status === 404 || res.status === 400;
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
