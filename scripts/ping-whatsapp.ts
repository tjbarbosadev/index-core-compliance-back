import '../src/lib/load-env.js';
import { env } from '../src/lib/env.js';
import {
  parseWhatsappDestinations,
  resolveOpenWaSessionId,
  sendWhatsappMessage,
} from '../src/services/whatsapp.service.js';

async function ensureSession(): Promise<{ sessionId: string; qr?: string | null }> {
  const baseUrl = env.openWaBaseUrl?.replace(/\/$/, '');
  const apiKey = env.openWaApiKey;
  if (!baseUrl || !apiKey) {
    throw new Error('Defina OPENWA_BASE_URL e OPENWA_API_KEY');
  }

  let sessionId = env.openWaSessionId?.trim() || '';
  if (!sessionId) {
    const resolved = await resolveOpenWaSessionId({
      baseUrl,
      apiKey,
      sessionName: env.openWaSessionName,
    });
    if (resolved) {
      sessionId = resolved;
    } else {
      const name = env.openWaSessionName || 'opcore-alerts';
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      const created = (await createRes.json().catch(() => ({}))) as {
        id?: string;
        sessionId?: string;
        message?: string;
      };
      sessionId = String(created.id || created.sessionId || '');
      if (!sessionId) {
        throw new Error(`Falha ao criar sessão OpenWA: ${JSON.stringify(created)}`);
      }
      console.log(`[ping-whatsapp] sessão criada name=${name} id=${sessionId}`);
    }
  }

  await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/start`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  }).catch(() => undefined);

  const statusRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  });
  const statusRow = (await statusRes.json().catch(() => ({}))) as { status?: string };
  console.log(`[ping-whatsapp] session=${sessionId} status=${statusRow.status ?? '?'}`);

  let qr: string | null = null;
  if (statusRow.status !== 'ready') {
    const qrRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/qr`, {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
    const qrRow = (await qrRes.json().catch(() => ({}))) as Record<string, unknown>;
    for (const key of ['qr', 'qrDataUrl', 'dataUrl', 'image', 'qrCode']) {
      const value = qrRow[key];
      if (typeof value === 'string' && value.trim()) {
        qr = value.trim();
        break;
      }
    }
    if (qr) {
      console.log('[ping-whatsapp] QR disponível (cole em navegador ou escaneie no WhatsApp):');
      console.log(qr.slice(0, 120) + (qr.length > 120 ? '…' : ''));
      console.log('[ping-whatsapp] reexecute este script após parear (status=ready)');
    } else {
      console.log(
        '[ping-whatsapp] sessão ainda não ready e sem QR — tente pairing-code no dashboard OpenWA',
      );
    }
  }

  return { sessionId, qr };
}

async function main() {
  const destinations = parseWhatsappDestinations(env.amortizationAlertWhatsappTo);
  console.log({
    enabled: env.amortizationAlertEnabled,
    baseUrl: env.openWaBaseUrl,
    hasApiKey: Boolean(env.openWaApiKey),
    sessionName: env.openWaSessionName,
    sessionId: env.openWaSessionId,
    destinations,
  });

  const { sessionId, qr } = await ensureSession();
  if (qr) {
    process.exitCode = 2;
    return;
  }

  if (destinations.length === 0) {
    console.error('Defina AMORTIZATION_ALERT_WHATSAPP_TO com E.164 (Johny,Bruno)');
    process.exitCode = 1;
    return;
  }

  for (const to of destinations) {
    const r = await sendWhatsappMessage({
      baseUrl: env.openWaBaseUrl,
      apiKey: env.openWaApiKey,
      sessionId,
      to,
      text: 'teste lembrete cotistas',
    });
    console.log({ to, ...r });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
