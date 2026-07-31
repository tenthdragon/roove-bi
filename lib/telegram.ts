// lib/telegram.ts — Telegram Bot API helper

import { createServiceSupabase } from './supabase-server';
import {
  resolveWorkspaceCredential,
  resolveWorkspaceIntegrationValue,
} from './workspace-integration-server';

const TELEGRAM_API = 'https://api.telegram.org';

function botUrl(botToken: string, method: string): string {
  return `${TELEGRAM_API}/bot${botToken}/${method}`;
}

async function getTelegramConfig(workspaceId: string) {
  const supabase = createServiceSupabase();
  const botToken = await resolveWorkspaceCredential({
    supabase,
    workspaceId,
    provider: 'telegram',
    fallbackEnvKeys: [],
  });
  const chatId = await resolveWorkspaceIntegrationValue({
    supabase,
    workspaceId,
    provider: 'telegram',
    configKey: 'chat_id',
    referenceConfigKey: 'chat_id_reference',
    fallbackEnvKeys: [],
  });
  if (!chatId) throw new Error('Chat Telegram belum dikonfigurasi untuk workspace ini.');
  return { botToken, chatId };
}

export async function sendTelegramMessage(workspaceId: string, text: string, options?: {
  replyMarkup?: any;
}): Promise<boolean> {
  const config = await getTelegramConfig(workspaceId);

  const body: any = {
    chat_id: config.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

  const res = await fetch(botUrl(config.botToken, 'sendMessage'), {
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
export async function sendTelegramToChat(workspaceId: string, targetChatId: string, text: string, options?: {
  replyMarkup?: any;
}): Promise<boolean> {
  if (!targetChatId) return false;
  const config = await getTelegramConfig(workspaceId);

  const body: any = {
    chat_id: targetChatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (options?.replyMarkup) body.reply_markup = options.replyMarkup;

  const res = await fetch(botUrl(config.botToken, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('[telegram] sendToChat failed:', await res.text());
    return false;
  }
  return true;
}

export async function answerCallbackQuery(workspaceId: string, callbackQueryId: string, text?: string): Promise<void> {
  const config = await getTelegramConfig(workspaceId);
  await fetch(botUrl(config.botToken, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

export async function resolveTelegramWebhookWorkspace(
  providedSecret: string | null,
  effectiveChatId: string | null,
) {
  if (!providedSecret) return null;
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from('workspace_integrations')
    .select('workspace_id, config')
    .eq('provider', 'telegram')
    .eq('is_active', true);
  if (error) throw error;

  for (const row of data || []) {
    const config = row.config && typeof row.config === 'object'
      ? row.config as Record<string, unknown>
      : {};
    const secretReference = String(config.webhook_secret_reference || '').trim();
    const expectedSecret = secretReference && /^[A-Z][A-Z0-9_]*$/.test(secretReference)
      ? process.env[secretReference]
      : String(config.webhook_secret || '').trim();
    if (!expectedSecret || expectedSecret !== providedSecret) continue;

    const chatReference = String(config.chat_id_reference || '').trim();
    const expectedChatId = String(
      config.chat_id
      || (chatReference && /^[A-Z][A-Z0-9_]*$/.test(chatReference)
        ? process.env[chatReference]
        : '')
      || '',
    ).trim();
    if (expectedChatId && effectiveChatId && expectedChatId !== effectiveChatId) continue;
    return String(row.workspace_id);
  }

  return null;
}
