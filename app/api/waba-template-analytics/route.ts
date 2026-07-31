import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardTabAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';

export const dynamic = 'force-dynamic';

const SUPABASE_PAGE_SIZE = 1000;
const TEMPLATE_ID_BATCH_SIZE = 100;
const MAX_TEMPLATE_IDS = 10000;

type AnalyticsInput = {
  template_ids?: unknown;
  start?: unknown;
  end?: unknown;
};

type AnalyticsRow = {
  template_id: string;
  date: string;
  sent: number | null;
  delivered: number | null;
  read: number | null;
  clicked: number | null;
  replied: number | null;
  cost: number | string | null;
};

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function authenticate() {
  try {
    const { workspaceId } = await requireDashboardTabAccess('waba-management', 'WABA Management');
    return { workspaceId };
  } catch (err: any) {
    return {
      error: err.message,
      status: /sesi|login/i.test(err.message || '') ? 401 : 403,
    };
  }
}

function parseAnalyticsInput(req: NextRequest, body?: AnalyticsInput) {
  const url = new URL(req.url);
  const rawTemplateIds = Array.isArray(body?.template_ids)
    ? body.template_ids
    : url.searchParams.get('template_ids')?.split(',') || [];
  const templateIds = Array.from(new Set(
    rawTemplateIds
      .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
      .map(String)
      .map((id) => id.trim())
      .filter(Boolean),
  ));

  return {
    templateIds,
    start: typeof body?.start === 'string' ? body.start : url.searchParams.get('start') || '',
    end: typeof body?.end === 'string' ? body.end : url.searchParams.get('end') || '',
  };
}

async function fetchAnalyticsRows(
  svc: ReturnType<typeof getServiceSupabase>,
  templateIds: string[],
  start: string,
  end: string,
  workspaceId: string,
) {
  const rows: AnalyticsRow[] = [];

  for (let batchStart = 0; batchStart < templateIds.length; batchStart += TEMPLATE_ID_BATCH_SIZE) {
    const idBatch = templateIds.slice(batchStart, batchStart + TEMPLATE_ID_BATCH_SIZE);
    let offset = 0;

    while (true) {
      const { data, error } = await svc
        .from('waba_template_daily_analytics')
        .select('template_id, date, sent, delivered, read, clicked, replied, cost')
        .eq('workspace_id', workspaceId)
        .in('template_id', idBatch)
        .gte('date', start)
        .lte('date', end)
        .order('date')
        .order('template_id')
        .range(offset, offset + SUPABASE_PAGE_SIZE - 1);

      if (error) throw error;

      const page = (data || []) as AnalyticsRow[];
      rows.push(...page);
      if (page.length < SUPABASE_PAGE_SIZE) break;
      offset += SUPABASE_PAGE_SIZE;
    }
  }

  return rows;
}

async function handleAnalyticsRequest(req: NextRequest, body?: AnalyticsInput) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'waba-template-analytics-read',
      30,
      10 * 60 * 1000,
      'Terlalu banyak permintaan analytics template WhatsApp. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const auth = await authenticate();
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const svc = getServiceSupabase();
    const { templateIds, start, end } = parseAnalyticsInput(req, body);

    if (templateIds.length === 0) {
      return NextResponse.json({ error: 'template_ids required' }, { status: 400 });
    }
    if (templateIds.length > MAX_TEMPLATE_IDS) {
      return NextResponse.json({ error: `Maximum ${MAX_TEMPLATE_IDS} template_ids allowed` }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end date required (YYYY-MM-DD)' }, { status: 400 });
    }

    const analyticsRows = await fetchAnalyticsRows(svc, templateIds, start, end, auth.workspaceId);

    const byTemplate: Record<string, { sent: number; delivered: number; read: number; clicked: number; replied: number; cost: number }> = {};
    const dailyMap: Record<string, { date: string; sent: number; delivered: number; read: number; clicked: number; replied: number }> = {};

    for (const row of analyticsRows) {
      if (!byTemplate[row.template_id]) {
        byTemplate[row.template_id] = {
          sent: 0,
          delivered: 0,
          read: 0,
          clicked: 0,
          replied: 0,
          cost: 0,
        };
      }

      byTemplate[row.template_id].sent += row.sent || 0;
      byTemplate[row.template_id].delivered += row.delivered || 0;
      byTemplate[row.template_id].read += row.read || 0;
      byTemplate[row.template_id].clicked += row.clicked || 0;
      byTemplate[row.template_id].replied += row.replied || 0;
      byTemplate[row.template_id].cost += Number(row.cost) || 0;

      if (!dailyMap[row.date]) {
        dailyMap[row.date] = { date: row.date, sent: 0, delivered: 0, read: 0, clicked: 0, replied: 0 };
      }
      dailyMap[row.date].sent += row.sent || 0;
      dailyMap[row.date].delivered += row.delivered || 0;
      dailyMap[row.date].read += row.read || 0;
      dailyMap[row.date].clicked += row.clicked || 0;
      dailyMap[row.date].replied += row.replied || 0;
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ byTemplate, daily });
  } catch (err: any) {
    console.error('[waba-template-analytics] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** GET — Backward-compatible template analytics endpoint. */
export async function GET(req: NextRequest) {
  return handleAnalyticsRequest(req);
}

/** POST — Preferred endpoint for large template ID lists. */
export async function POST(req: NextRequest) {
  let body: AnalyticsInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  return handleAnalyticsRequest(req, body);
}
