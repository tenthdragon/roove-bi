import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport, buildMonthlyReport } from '@/lib/daily-report';
import { sendTelegramMessage } from '@/lib/telegram';

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
      const report = await buildMonthlyReport();
      await sendTelegramMessage(report);
    } else if (command === '/help') {
      await sendTelegramMessage(
        '<b>Available commands:</b>\n\n' +
        '/report — Daily report (yesterday vs avg bulan ini)\n' +
        '/monthly — Monthly report (MTD vs bulan lalu)\n' +
        '/help — Show this help message'
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[telegram-webhook] Error:', err);
    return NextResponse.json({ ok: true });
  }
}
