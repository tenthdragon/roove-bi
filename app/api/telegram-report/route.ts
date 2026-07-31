import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { buildDailyReport } from '@/lib/daily-report';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { sendTelegramMessage } from '@/lib/telegram';
import { resolveScheduledWorkspaceIds } from '@/lib/workspace-scheduler';

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
    let workspaceIds: string[] = [];

    if (!isCron) {
      const originError = rejectUntrustedOrigin(req);
      if (originError) return originError;

      const sessionError = rejectMissingDashboardSession(req);
      if (sessionError) return sessionError;

      const rateLimitError = limitByIp(
        req,
        'telegram-report',
        4,
        10 * 60 * 1000,
        'Terlalu banyak permintaan Telegram report. Coba lagi beberapa menit lagi.',
      );
      if (rateLimitError) return rateLimitError;

      try {
        const access = await requireDashboardRoles(['owner'], 'Hanya owner yang bisa menjalankan Telegram report manual.');
        workspaceIds = [access.workspaceId];
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        return NextResponse.json({ ok: false, error: err.message, serverTime: wibStr }, { status });
      }
    } else {
      workspaceIds = await resolveScheduledWorkspaceIds(
        req.nextUrl.searchParams.get('workspace_id'),
        'telegram',
      );
    }

    const isDebug = req.nextUrl.searchParams.get('debug') === '1';
    const results = [];
    for (const workspaceId of workspaceIds) {
      const message = await buildDailyReport(workspaceId);
      const sent = isDebug
        ? true
        : await sendTelegramMessage(workspaceId, message);
      results.push({ workspaceId, sent, message });
    }
    const failed = results.filter((result) => !result.sent);
    return NextResponse.json({
      ok: failed.length === 0,
      serverTime: wibStr,
      results,
    }, { status: failed.length === 0 ? 200 : 500 });
  } catch (err: any) {
    console.error('[telegram-report] Error:', err);
    return NextResponse.json({ ok: false, error: err.message, serverTime: wibStr }, { status: 500 });
  }
}
