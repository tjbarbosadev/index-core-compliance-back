import { Resend } from 'resend';
import { env } from '../lib/env.js';

export type PartnerTokenEmailKind = 'created' | 'rotated';

export type SendEmailResult = {
  sent: boolean;
  reason: 'resend_skipped' | 'resend_error' | 'sent';
};

async function sendResendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<SendEmailResult> {
  if (!env.resendApiKey) {
    console.warn('[email] RESEND_API_KEY ausente — e-mail não enviado', {
      to: maskEmail(input.to),
      subject: input.subject,
    });
    return { sent: false, reason: 'resend_skipped' };
  }

  try {
    const resend = new Resend(env.resendApiKey);
    const result = await resend.emails.send({
      from: env.emailFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    if (result.error) {
      console.error('[email] Resend error:', result.error, {
        to: maskEmail(input.to),
        subject: input.subject,
        from: env.emailFrom,
      });
      return { sent: false, reason: 'resend_error' };
    }
    console.info('[email] enviado', {
      to: maskEmail(input.to),
      subject: input.subject,
      id: result.data?.id,
    });
    return { sent: true, reason: 'sent' };
  } catch (err) {
    console.error('[email] Falha ao enviar:', err, {
      to: maskEmail(input.to),
      subject: input.subject,
    });
    return { sent: false, reason: 'resend_error' };
  }
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export async function sendPartnerTokenEmail(input: {
  to: string;
  partnerName: string;
  token: string;
  kind: PartnerTokenEmailKind;
}): Promise<SendEmailResult> {
  const subject =
    input.kind === 'created'
      ? `Token de acesso OpCore — ${input.partnerName}`
      : `Novo token de acesso OpCore — ${input.partnerName}`;

  const intro =
    input.kind === 'created'
      ? `Foi gerado um token de acesso à API OpCore para o parceiro “${input.partnerName}”.`
      : `O token de acesso à API OpCore do parceiro “${input.partnerName}” foi rotacionado.`;

  const text = [
    intro,
    '',
    `Token: ${input.token}`,
    '',
    'Guarde este token com segurança. Por segurança, ele não será enviado novamente neste formato.',
    'Não compartilhe o token com terceiros.',
  ].join('\n');

  const html = `
    <p>${escapeHtml(intro)}</p>
    <p><strong>Token:</strong></p>
    <p><code style="word-break:break-all;font-size:14px">${escapeHtml(input.token)}</code></p>
    <p>Guarde este token com segurança. Por segurança, ele não será enviado novamente neste formato.</p>
    <p>Não compartilhe o token com terceiros.</p>
  `;

  return sendResendEmail({ to: input.to, subject, text, html });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  name: string;
  resetUrl: string;
}): Promise<SendEmailResult> {
  const subject = 'Redefinição de senha — IndexCore';
  const intro = `Olá, ${input.name}. Recebemos um pedido para redefinir a senha da sua conta.`;
  const text = [
    intro,
    '',
    'Acesse o link abaixo para escolher uma nova senha (válido por 1 hora):',
    input.resetUrl,
    '',
    'Se você não solicitou esta alteração, ignore este e-mail.',
  ].join('\n');

  const html = `
    <p>${escapeHtml(intro)}</p>
    <p>Acesse o link abaixo para escolher uma nova senha (válido por 1 hora):</p>
    <p><a href="${escapeHtml(input.resetUrl)}">${escapeHtml(input.resetUrl)}</a></p>
    <p>Se você não solicitou esta alteração, ignore este e-mail.</p>
  `;

  const result = await sendResendEmail({ to: input.to, subject, text, html });
  logDebugUrlIfNeeded(result, input.resetUrl);
  return result;
}

export async function sendUserInviteEmail(input: {
  to: string;
  name: string;
  inviteUrl: string;
}): Promise<SendEmailResult> {
  const subject = 'Convite para acessar o IndexCore';
  const intro = `Olá, ${input.name}. Uma conta foi criada para você no IndexCore Admin.`;
  const text = [
    intro,
    '',
    'Para definir sua senha e acessar a plataforma, use o link abaixo (válido por 1 hora):',
    input.inviteUrl,
    '',
    'Se você não esperava este convite, ignore este e-mail.',
  ].join('\n');

  const html = `
    <p>${escapeHtml(intro)}</p>
    <p>Para definir sua senha e acessar a plataforma, use o link abaixo (válido por 1 hora):</p>
    <p><a href="${escapeHtml(input.inviteUrl)}">${escapeHtml(input.inviteUrl)}</a></p>
    <p>Se você não esperava este convite, ignore este e-mail.</p>
  `;

  const result = await sendResendEmail({ to: input.to, subject, text, html });
  logDebugUrlIfNeeded(result, input.inviteUrl);
  return result;
}

function logDebugUrlIfNeeded(result: SendEmailResult, url: string) {
  if (result.sent) return;
  if (env.nodeEnv === 'production' && !env.emailDebug) return;
  console.warn('[email] link de fallback (EMAIL_DEBUG / não-produção):', url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
