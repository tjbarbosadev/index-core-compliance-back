import './load-env.js';

function parseCorsOrigins(): string[] {
  const multi = process.env.CORS_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi && multi.length > 0) return multi;
  const single = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  return [single];
}

function isLocalhostUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * URL pública do front para links de e-mail.
 * Em produção, nunca usa localhost — mesmo se WEB_URL/CORS estiverem errados.
 */
function resolveWebUrl(): string {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const explicit = process.env.WEB_URL?.trim().replace(/\/$/, '');
  const origins = parseCorsOrigins().map((o) => o.replace(/\/$/, ''));
  const publicOrigin = origins.find((o) => !isLocalhostUrl(o));

  if (explicit && !(nodeEnv === 'production' && isLocalhostUrl(explicit))) {
    return explicit;
  }

  if (explicit && nodeEnv === 'production' && isLocalhostUrl(explicit)) {
    console.warn(
      '[env] WEB_URL está como localhost em produção — ignorando e usando origem pública do CORS',
    );
  }

  if (publicOrigin) return publicOrigin;

  const fallback = origins[0] ?? 'http://localhost:5173';
  if (nodeEnv === 'production' && isLocalhostUrl(fallback)) {
    console.error(
      '[env] Sem WEB_URL/CORS público — links de e-mail apontarão para localhost. Defina WEB_URL=https://admin.opcore.com.br',
    );
  }
  return fallback;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  /** URL pública da API (monta uploadUrl para o browser). */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  /** URL pública do front (links de e-mail, ex.: redefinir senha). */
  webUrl: resolveWebUrl(),
  /** Diretório base para arquivos de documentos no servidor. */
  storagePath: process.env.STORAGE_PATH ?? './storage',
  /** Allowlist de origins dos sites próprios (admin.opcore, IndexCore, localhost). */
  corsOrigins: parseCorsOrigins(),
  /** @deprecated use corsOrigins */
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me-min-32-characters',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  sessionMaxAgeHours: 8,
  /** Grace period em horas para o token anterior após rotação. */
  partnerTokenGraceHours: Number(process.env.PARTNER_TOKEN_GRACE_HOURS ?? 24),
  /** Resend — vazio em local; preencher no ambiente oficial. */
  resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
  /** Evitar noreply@ — Resend recomenda endereço que aceite resposta. */
  emailFrom: process.env.EMAIL_FROM ?? 'OpCore <acesso@opcore.com.br>',
  /** Em produção, força log do link de reset/convite quando o envio falha. */
  emailDebug: process.env.EMAIL_DEBUG === '1' || process.env.EMAIL_DEBUG === 'true',
  /** Alerta amortização Sênior I (admin) — off por padrão; CI sem secrets. */
  amortizationAlertEnabled:
    process.env.AMORTIZATION_ALERT_ENABLED === '1' ||
    process.env.AMORTIZATION_ALERT_ENABLED === 'true',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
  amortizationAlertTelegramChatId:
    process.env.AMORTIZATION_ALERT_TELEGRAM_CHAT_ID?.trim() || undefined,
  amortizationAlertEmail: process.env.AMORTIZATION_ALERT_EMAIL?.trim() || undefined,
  /** Destinos WhatsApp (Johny/Bruno) — E.164 separados por vírgula. */
  amortizationAlertWhatsappTo: process.env.AMORTIZATION_ALERT_WHATSAPP_TO?.trim() || undefined,
  /** OpenWA gateway (CRM `crm_openwa` na rede caddy). Todos opcionais — CI/boot sem secrets. */
  openWaBaseUrl: process.env.OPENWA_BASE_URL?.trim().replace(/\/$/, '') || undefined,
  openWaApiKey: process.env.OPENWA_API_KEY?.trim() || undefined,
  /** Session id explícito; se vazio, resolve por `openWaSessionName`. */
  openWaSessionId: process.env.OPENWA_SESSION_ID?.trim() || undefined,
  openWaSessionName: process.env.OPENWA_SESSION_NAME?.trim() || 'opcore-alerts',
  /** Hub opcore-compliance — key vazia: API sobe; kyc.generate falha com mensagem clara. */
  complianceApiUrl: (
    process.env.COMPLIANCE_API_URL ?? 'https://api.compliance.opcore.com.br'
  ).replace(/\/$/, ''),
  complianceApiServiceKey: process.env.COMPLIANCE_API_SERVICE_KEY?.trim() || '',
  complianceApiSub: process.env.COMPLIANCE_API_SUB?.trim() || 'admin',
  complianceApiService: process.env.COMPLIANCE_API_SERVICE?.trim() || 'admin',
  /** nextcorefim — documentos Mega do FIM; key vazia: rotas FIM falham com mensagem clara. */
  nextcorefimApiUrl: (process.env.NEXTCOREFIM_API_URL ?? 'http://localhost:3001').replace(
    /\/$/,
    '',
  ),
  nextcorefimApiServiceKey: process.env.NEXTCOREFIM_API_SERVICE_KEY?.trim() || '',
  /** Ingest de propostas dos sites FIDC/FIM — key vazia: POST /internal/proposals retorna 503. */
  proposalIngestServiceKey: process.env.PROPOSAL_INGEST_SERVICE_KEY?.trim() || '',
};
