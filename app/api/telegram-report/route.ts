import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport } from '@/lib/daily-report';
import { sendTelegramMessage } from '@/lib/telegram';

export const maxDuration = 250;

export async function GET(req: NextRequest) {
  try {
    const message = await buildDailyReport();
    const sent = await sendTelegramMessage(message);

    if (!sent) {
      return NextResponse.json({ ok: false, error: 'Failed to send Telegram message' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message });
  } catch (err: any) {
    console.error('[telegram-report] Error:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
