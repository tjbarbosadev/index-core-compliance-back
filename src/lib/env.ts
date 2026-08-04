import 'dotenv/config';

function parseCorsOrigins(): string[] {
  const multi = process.env.CORS_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi && multi.length > 0) return multi;
  const single = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  return [single];
}

function resolveWebUrl(): string {
  const explicit = process.env.WEB_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const origins = parseCorsOrigins();
  return (origins[0] ?? 'http://localhost:5173').replace(/\/$/, '');
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
  emailFrom: process.env.EMAIL_FROM ?? 'OpCore <noreply@opcore.com.br>',
  /** Em produção, força log do link de reset/convite quando o envio falha. */
  emailDebug: process.env.EMAIL_DEBUG === '1' || process.env.EMAIL_DEBUG === 'true',
};
