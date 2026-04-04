import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport } from '@/lib/daily-report';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body?.message;
    if (!message?.text) return NextResponse.json({ ok: true });

    const chatId = String(message.chat.id);
    const expectedChatId = process.env.TELEGRAM_CHAT_ID;
    if (expectedChatId && chatId !== expectedChatId) {
      return NextResponse.json({ ok: true }); // ignore other chats
    }

    const command = message.text.trim().toLowerCase();

    if (command === '/report') {
      await sendTelegramMessage('Generating daily report...');
      const report = await buildDailyReport();
      await sendTelegramMessage(report);
    } else if (command === '/help') {
      await sendTelegramMessage(
        '<b>Available commands:</b>\n\n' +
        '/report — Generate daily report (yesterday)\n' +
        '/help — Show this help message'
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[telegram-webhook] Error:', err);
    return NextResponse.json({ ok: true }); // always 200 to avoid Telegram retries
  }
}
