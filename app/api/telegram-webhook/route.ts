import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport, buildMonthlyReport } from '@/lib/daily-report';
import { analyzeMonthlyReport } from '@/lib/opus-analyst';
import { sendTelegramMessage, answerCallbackQuery } from '@/lib/telegram';
import {
  approveStockReclassRequestViaTelegram,
  rejectStockReclassRequestViaTelegram,
} from '@/lib/warehouse-ledger-actions';

export const maxDuration = 300;

function isAuthorizedTelegramWebhook(req: NextRequest) {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configuredSecret) return true;
  return req.headers.get('x-telegram-bot-api-secret-token') === configuredSecret;
}

function extractChatId(body: any): string | null {
  const callbackChatId = body?.callback_query?.message?.chat?.id;
  const messageChatId = body?.message?.chat?.id;
  const effective = callbackChatId ?? messageChatId;
  return effective != null ? String(effective) : null;
}

function isAnalyzePayloadValid(parts: string[]) {
  if (parts.length !== 5) return false;
  return parts.slice(1).every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function parseReclassCallbackData(data: string) {
  const parts = data.split(':');
  if (parts.length !== 3 || parts[0] !== 'reclass') return null;
  const action = parts[1];
  const requestId = Number(parts[2]);
  if (!['approve', 'reject'].includes(action) || !Number.isFinite(requestId) || requestId <= 0) {
    return null;
  }
  return { action, requestId };
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorizedTelegramWebhook(req)) {
      console.warn('[telegram-webhook] Rejected request with invalid secret token');
      return NextResponse.json({ ok: true });
    }

    const body = await req.json();
    const expectedChatId = process.env.TELEGRAM_CHAT_ID;
    const effectiveChatId = extractChatId(body);

    const callbackData = body?.callback_query?.data || '';
    const isReclassCallback = callbackData.startsWith('reclass:');

    if (!isReclassCallback && expectedChatId && effectiveChatId && effectiveChatId !== expectedChatId) {
      return NextResponse.json({ ok: true });
    }

    // Handle callback query (inline button press)
    if (body.callback_query) {
      const cb = body.callback_query;
      const data = cb.data || '';

      if (data.startsWith('reclass:')) {
        const parsed = parseReclassCallbackData(data);
        if (!parsed) {
          await answerCallbackQuery(cb.id, 'Payload reklasifikasi tidak valid.');
          return NextResponse.json({ ok: true });
        }

        const chatId = extractChatId(body);
        if (!chatId) {
          await answerCallbackQuery(cb.id, 'Chat Telegram tidak dikenali.');
          return NextResponse.json({ ok: true });
        }

        try {
          if (parsed.action === 'approve') {
            const result = await approveStockReclassRequestViaTelegram(parsed.requestId, chatId);
            await answerCallbackQuery(cb.id, `Request #${result.requestId} berhasil di-approve.`);
          } else {
            const result = await rejectStockReclassRequestViaTelegram(parsed.requestId, chatId);
            await answerCallbackQuery(cb.id, `Request #${result.requestId} berhasil di-reject.`);
          }
        } catch (err: any) {
          const message = (err?.message || 'Gagal memproses reklasifikasi.').slice(0, 180);
          await answerCallbackQuery(cb.id, message);
        }

        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('analyze:')) {
        await answerCallbackQuery(cb.id, 'Starting analysis...');
        const parts = data.split(':');
        if (!isAnalyzePayloadValid(parts)) {
          await sendTelegramMessage('❌ <b>Analysis failed</b>\n\n<i>Payload analisis tidak valid.</i>');
          return NextResponse.json({ ok: true });
        }
        const [, thisFrom, thisTo, prevFrom, prevTo] = parts;

        await sendTelegramMessage('🧠 <b>Opus sedang menganalisis data...</b>\n<i>Querying database & building insights (30-90 detik)</i>');

        try {
          const reportText = cb.message?.text || '';
          const result = await analyzeMonthlyReport(reportText, thisFrom, thisTo, prevFrom, prevTo);
          const costLine = `\n\n<i>📊 ${result.iterations} iterations · ${result.toolCalls.length} tool calls · ${result.inputTokens.toLocaleString()} in + ${result.outputTokens.toLocaleString()} out · $${result.costUsd.toFixed(3)}</i>`;
          await sendTelegramMessage(`🧠 <b>Opus Analysis</b>\n\n${result.text}${costLine}`);
        } catch (err: any) {
          console.error('[telegram-webhook] Opus error:', err);
          const errMsg = err?.message || 'Unknown error';
          await sendTelegramMessage(`❌ <b>Analysis failed</b>\n\n<code>${errMsg.slice(0, 200)}</code>\n\n<i>Coba lagi dengan /monthly lalu tekan tombol Analyze.</i>`);
        }
      }

      return NextResponse.json({ ok: true });
    }

    // Handle regular messages
    const message = body?.message;
    if (!message?.text) return NextResponse.json({ ok: true });

    const chatId = String(message.chat.id);
    if (expectedChatId && chatId !== expectedChatId) {
      return NextResponse.json({ ok: true });
    }

    const command = message.text.trim().toLowerCase();

    if (command === '/report') {
      await sendTelegramMessage('Generating daily report...');
      const report = await buildDailyReport();
      await sendTelegramMessage(report);

    } else if (command === '/monthly') {
      await sendTelegramMessage('Generating monthly report...');
      const result = await buildMonthlyReport();

      const callbackData = `analyze:${result.thisMonthFrom}:${result.thisMonthTo}:${result.prevMonthFrom}:${result.prevMonthTo}`;
      await sendTelegramMessage(result.message, {
        replyMarkup: {
          inline_keyboard: [[
            { text: '🧠 Analyze with Opus', callback_data: callbackData },
          ]],
        },
      });

    } else if (command === '/help') {
      await sendTelegramMessage(
        '<b>Available commands:</b>\n\n' +
        '/report — Daily report (yesterday vs avg bulan ini)\n' +
        '/monthly — Monthly report (MTD vs bulan lalu)\n' +
        '/help — Show this help message\n\n' +
        '<i>Monthly report includes an "Analyze" button for AI-powered insights.</i>'
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[telegram-webhook] Error:', err);
    return NextResponse.json({ ok: true });
  }
}
