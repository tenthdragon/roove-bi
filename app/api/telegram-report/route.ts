import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport } from '@/lib/daily-report';
import { sendTelegramMessage } from '@/lib/telegram';

export const maxDuration = 250;

export async function GET(req: NextRequest) {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600_000);
  const wibStr = `${wib.getFullYear()}-${String(wib.getMonth() + 1).padStart(2, '0')}-${String(wib.getDate()).padStart(2, '0')} ${String(wib.getHours()).padStart(2, '0')}:${String(wib.getMinutes()).padStart(2, '0')}`;

  try {
    console.log(`[telegram-report] Triggered at ${wibStr} WIB (${now.toISOString()} UTC)`);
    const message = await buildDailyReport();
    const sent = await sendTelegramMessage(message);

    if (!sent) {
      return NextResponse.json({ ok: false, error: 'Failed to send Telegram message', serverTime: wibStr }, { status: 500 });
    }

    return NextResponse.json({ ok: true, serverTime: wibStr, message });
  } catch (err: any) {
    console.error('[telegram-report] Error:', err);
    return NextResponse.json({ ok: false, error: err.message, serverTime: wibStr }, { status: 500 });
  }
}
