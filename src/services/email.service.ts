import { Resend } from 'resend';
import { env } from '../lib/env.js';

export type PartnerTokenEmailKind = 'created' | 'rotated';

export async function sendPartnerTokenEmail(input: {
  to: string;
  partnerName: string;
  token: string;
  kind: PartnerTokenEmailKind;
}): Promise<{ sent: boolean }> {
  if (!env.resendApiKey) {
    console.warn('[email] RESEND_API_KEY ausente — e-mail do token não enviado');
    return { sent: false };
  }

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
    <p>${intro}</p>
    <p><strong>Token:</strong></p>
    <p><code style="word-break:break-all;font-size:14px">${escapeHtml(input.token)}</code></p>
    <p>Guarde este token com segurança. Por segurança, ele não será enviado novamente neste formato.</p>
    <p>Não compartilhe o token com terceiros.</p>
  `;

  try {
    const resend = new Resend(env.resendApiKey);
    const result = await resend.emails.send({
      from: env.emailFrom,
      to: input.to,
      subject,
      text,
      html,
    });
    if (result.error) {
      console.error('[email] Resend error:', result.error);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error('[email] Falha ao enviar token:', err);
    return { sent: false };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
