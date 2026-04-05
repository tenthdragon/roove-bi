import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport, buildMonthlyReport } from '@/lib/daily-report';
import { analyzeMonthlyReport } from '@/lib/opus-analyst';
import { sendTelegramMessage, answerCallbackQuery } from '@/lib/telegram';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Handle callback query (inline button press)
    if (body.callback_query) {
      const cb = body.callback_query;
      const data = cb.data || '';

      if (data.startsWith('analyze:')) {
        await answerCallbackQuery(cb.id, 'Analyzing with Opus...');
        // Parse params: analyze:thisFrom:thisTo:prevFrom:prevTo
        const parts = data.split(':');
        const [, thisFrom, thisTo, prevFrom, prevTo] = parts;

        await sendTelegramMessage('🧠 <b>Opus sedang menganalisis data...</b>\n<i>Ini mungkin memakan waktu 30-60 detik.</i>');

        // Get the report text from the original message
        const reportText = cb.message?.text || '';

        const result = await analyzeMonthlyReport(reportText, thisFrom, thisTo, prevFrom, prevTo);
        const costLine = `\n\n<i>📊 ${result.iterations} iterations · ${result.toolCalls.length} tool calls · ${result.inputTokens.toLocaleString()} in + ${result.outputTokens.toLocaleString()} out · $${result.costUsd.toFixed(3)}</i>`;
        await sendTelegramMessage(`🧠 <b>Opus Analysis</b>\n\n${result.text}${costLine}`);
      }

      return NextResponse.json({ ok: true });
    }

    // Handle regular messages
    const message = body?.message;
    if (!message?.text) return NextResponse.json({ ok: true });

    const chatId = String(message.chat.id);
    const expectedChatId = process.env.TELEGRAM_CHAT_ID;
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

      // Send report with inline "Analyze" button
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
