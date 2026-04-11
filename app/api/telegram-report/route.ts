import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { buildDailyReport } from '@/lib/daily-report';
import { sendTelegramMessage } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 250;

export async function GET(req: NextRequest) {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600_000);
  const wibStr = `${wib.getFullYear()}-${String(wib.getMonth() + 1).padStart(2, '0')}-${String(wib.getDate()).padStart(2, '0')} ${String(wib.getHours()).padStart(2, '0')}:${String(wib.getMinutes()).padStart(2, '0')}`;

  try {
    const authHeader = req.headers.get('authorization');
    const secret = req.nextUrl.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = !!cronSecret && (authHeader === `Bearer ${cronSecret}` || secret === cronSecret);

    if (!isCron) {
      try {
        await requireDashboardRoles(['owner'], 'Hanya owner yang bisa menjalankan Telegram report manual.');
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        return NextResponse.json({ ok: false, error: err.message, serverTime: wibStr }, { status });
      }
    }

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
