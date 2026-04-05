// lib/telegram.ts — Telegram Bot API helper

const TELEGRAM_API = 'https://api.telegram.org';

function botUrl(method: string): string {
  return `${TELEGRAM_API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

function chatId(): string {
  return process.env.TELEGRAM_CHAT_ID || '';
}

export async function sendTelegramMessage(text: string, options?: {
  replyMarkup?: any;
}): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId()) {
    console.error('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    return false;
  }

  const body: any = {
    chat_id: chatId(),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

  const res = await fetch(botUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('[telegram] sendMessage failed:', await res.text());
    return false;
  }
  return true;
}

// Send message to a specific chat ID (for per-user notifications)
export async function sendTelegramToChat(targetChatId: string, text: string): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !targetChatId) return false;

  const res = await fetch(botUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: targetChatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    console.error('[telegram] sendToChat failed:', await res.text());
    return false;
  }
  return true;
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await fetch(botUrl('answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}
