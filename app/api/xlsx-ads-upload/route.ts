// app/api/xlsx-ads-upload/route.ts
// Accepts pre-parsed JSON rows from client-side xlsx parsing (avoids file size limits)
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 120;

const ALLOWED_STORES = new Set([
  'Roove', 'Purvu', 'Purvu Store', 'Osgard', 'Pluve', 'Calmara', 'DrHyun', 'YUV',
]);

const STORE_NORMALIZE: Record<string, string> = {
  'Clola': 'YUV',
  'Plume': 'Pluve',
};

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'xlsx-ads-upload',
      12,
      10 * 60 * 1000,
      'Terlalu banyak upload ads. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    let profileId: string | null = null;
    try {
      const { profile } = await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
      profileId = profile.id;
    } catch (err: any) {
      const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
      return NextResponse.json({ error: err.message }, { status });
    }

    const body = await req.json();
    const { filename, rows: rawRows } = body;

    if (!rawRows || !Array.isArray(rawRows) || rawRows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    }

    // Process rows
    const rows: any[] = [];
    let skipped = 0;
    const skippedStores = new Set<string>();

    for (const raw of rawRows) {
      // Parse date
      let dateStr = String(raw.date || '').trim();
      if (dateStr.includes('T')) dateStr = dateStr.split('T')[0];
      const dateMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!dateMatch) continue;
      const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;

      // Parse spent
      const spent = parseFloat(String(raw.spent || '0').replace(/,/g, ''));
      if (isNaN(spent) || spent <= 0) continue;

      // Normalize store
      let store = String(raw.store || '').trim();
      if (STORE_NORMALIZE[store]) store = STORE_NORMALIZE[store];

      if (!ALLOWED_STORES.has(store)) {
        skipped++;
        if (store) skippedStores.add(store);
        continue;
      }

      rows.push({
        date,
        ad_account: raw.ad_account || null,
        spent,
        objective: raw.objective || null,
        source: raw.source || null,
        store,
        advertiser: raw.advertiser || null,
        data_source: 'xlsx_upload',
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({
        error: 'No valid rows found after filtering',
        skipped,
        skippedStores: Array.from(skippedStores),
      }, { status: 400 });
    }

    // Determine date range
    const dates = rows.map(r => r.date).sort();
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];
    const storesToReplace = Array.from(new Set(rows.map((row) => row.store).filter(Boolean)));

    const svc = getServiceSupabase();

    if (storesToReplace.length === 0) {
      return NextResponse.json({ error: 'No valid store rows found after filtering' }, { status: 400 });
    }

    // Replace only the uploaded store slices so one file does not wipe other XLSX stores in the same date range.
    const { error: delErr } = await svc
      .from('daily_ads_spend')
      .delete()
      .eq('data_source', 'xlsx_upload')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .in('store', storesToReplace);

    if (delErr) {
      return NextResponse.json({ error: `Delete failed: ${delErr.message}` }, { status: 500 });
    }

    // Batch insert
    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insErr } = await svc.from('daily_ads_spend').insert(batch);
      if (insErr) {
        return NextResponse.json({
          error: `Insert failed at batch ${Math.floor(i / batchSize)}: ${insErr.message}`,
          inserted,
        }, { status: 500 });
      }
      inserted += batch.length;
    }

    // Log to data_imports
    await svc.from('data_imports').insert({
      filename: filename || 'unknown.xlsx',
      period_month: parseInt(dateFrom.split('-')[1]),
      period_year: parseInt(dateFrom.split('-')[0]),
      imported_by: profileId,
      row_count: inserted,
      status: 'completed',
      notes: `XLSX ads upload: ${inserted} rows (${skipped} skipped). Date range: ${dateFrom} to ${dateTo}. Stores: ${storesToReplace.join(', ')}`,
    });

    return NextResponse.json({
      success: true,
      inserted,
      skipped,
      skippedStores: Array.from(skippedStores),
      replacedStores: storesToReplace,
      dateRange: { from: dateFrom, to: dateTo },
      filename,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
