import '../src/lib/load-env.js';
import { env } from '../src/lib/env.js';
import { sendTelegramMessage } from '../src/services/telegram.service.js';

async function main() {
  const r = await sendTelegramMessage({
    token: env.telegramBotToken,
    chatId: env.amortizationAlertTelegramChatId,
    text: 'Ping OpCore — alerta de amortização OK',
  });
  console.log(r);
  console.log({
    enabled: env.amortizationAlertEnabled,
    hasToken: Boolean(env.telegramBotToken),
    chatId: env.amortizationAlertTelegramChatId,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
