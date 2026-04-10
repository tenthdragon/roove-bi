import { NextRequest, NextResponse } from 'next/server';
import { buildDailyReport } from '@/lib/daily-report';
import { sendTelegramMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 250;

export async function GET(req: NextRequest) {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600_000);
  const wibStr = `${wib.getFullYear()}-${String(wib.getMonth() + 1).padStart(2, '0')}-${String(wib.getDate()).padStart(2, '0')} ${String(wib.getHours()).padStart(2, '0')}:${String(wib.getMinutes()).padStart(2, '0')}`;

  try {
    const message = await buildDailyReport();
    // @ts-ignore — debug data from buildDailyReport
    const debug = (buildDailyReport as any)._debug || {};

    const isDebug = req.nextUrl.searchParams.get('debug') === '1';
    if (!isDebug) {
      const sent = await sendTelegramMessage(message);
      if (!sent) return NextResponse.json({ ok: false, error: 'Failed to send', serverTime: wibStr }, { status: 500 });
    }
    return NextResponse.json({ ok: true, serverTime: wibStr, debug, message });
  } catch (err: any) {
    console.error('[telegram-report] Error:', err);
    return NextResponse.json({ ok: false, error: err.message, serverTime: wibStr }, { status: 500 });
  }
}
