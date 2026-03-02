import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseGoogleSheet } from '@/lib/google-sheets';
import { triggerViewRefresh } from '@/lib/refresh-views';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const supabase = createServerSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'owner' && profile?.role !== 'finance') {
        return NextResponse.json({ error: 'Only owners and finance users can sync' }, { status: 403 });
      }
    }

    const svc = getServiceSupabase();

    // Get active sheet connections
    const { data: connections, error: connError } = await svc
      .from('sheet_connections')
      .select('*')
      .eq('is_active', true);

    if (connError) throw connError;
    if (!connections || connections.length === 0) {
      return NextResponse.json({ message: 'No active sheet connections', synced: 0 });
    }

    // ── Read active brands from database ──
    const { data: brands, error: brandsError } = await svc
      .from('brands')
      .select('name, sheet_name')
      .eq('is_active', true);

    if (brandsError) throw brandsError;
    const brandList = brands || [];

    const results = [];

    for (const conn of connections) {
      try {
        console.log(`Syncing ads from spreadsheet: ${conn.spreadsheet_id} (${conn.label})`);

        // Parse Google Sheet — only ads data is used now
        // (brand tabs are still parsed for period detection, but dailyProduct/dailyChannel are ignored)
        const parsed = await parseGoogleSheet(conn.spreadsheet_id, brandList);

        if (!parsed.period.month || !parsed.period.year) {
          results.push({
            spreadsheet_id: conn.spreadsheet_id,
            label: conn.label,
            success: false,
            error: 'Could not detect period from sheet',
          });
          continue;
        }

        const periodStart = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-01`;
        const lastDay = new Date(parsed.period.year, parsed.period.month, 0).getDate();
        const periodEnd = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        // ── Only sync ads data ──
        // daily_product_summary and daily_channel_data are now materialized views
        // populated from scalev_order_lines, NOT from Google Sheet.

        // Delete existing Google Sheets ads for this period (preserve Meta API data)
        const del3 = await svc.from('daily_ads_spend').delete()
          .gte('date', periodStart).lte('date', periodEnd)
          .eq('data_source', 'google_sheets');
        if (del3.error) throw new Error(`Delete daily_ads_spend: ${del3.error.message}`);

        // Create/update import record
        const { error: upsertErr } = await svc.from('data_imports').upsert({
          filename: `gsheet:${conn.spreadsheet_id}`,
          period_month: parsed.period.month,
          period_year: parsed.period.year,
          imported_by: conn.created_by,
          row_count: parsed.ads.length,
          status: 'processing',
          notes: `Ads sync from Google Sheet: ${conn.label}`,
        }, { onConflict: 'period_month,period_year,filename' });
        if (upsertErr) throw new Error(`Upsert data_imports: ${upsertErr.message}`);

        // Insert ads data (batched)
        if (parsed.ads.length > 0) {
          for (let i = 0; i < parsed.ads.length; i += 500) {
            const batch = parsed.ads.slice(i, i + 500);
            const { error } = await svc.from('daily_ads_spend').insert(batch);
            if (error) throw error;
          }
        }

        // Mark import as completed
        await svc.from('data_imports').update({
          status: 'completed',
          row_count: parsed.ads.length,
        }).eq('filename', `gsheet:${conn.spreadsheet_id}`)
          .eq('period_month', parsed.period.month)
          .eq('period_year', parsed.period.year);

        // Update last_synced on connection
        await svc.from('sheet_connections').update({
          last_synced: new Date().toISOString(),
          last_sync_status: 'success',
          last_sync_message: `Synced ${parsed.ads.length} ad rows (ads-only mode)`,
        }).eq('id', conn.id);

        // Refresh materialized views (ads data affects mkt_cost in MVs)
        if (parsed.ads.length > 0) {
          triggerViewRefresh();
        }

        results.push({
          spreadsheet_id: conn.spreadsheet_id,
          label: conn.label,
          success: true,
          period: parsed.period,
          counts: { ads: parsed.ads.length },
        });

      } catch (err: any) {
        console.error(`Sync failed for ${conn.spreadsheet_id}:`, err);

        await svc.from('sheet_connections').update({
          last_synced: new Date().toISOString(),
          last_sync_status: 'error',
          last_sync_message: err.message || 'Unknown error',
        }).eq('id', conn.id);

        results.push({
          spreadsheet_id: conn.spreadsheet_id,
          label: conn.label,
          success: false,
          error: err.message,
        });
      }
    }

    return NextResponse.json({
      synced: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });

  } catch (err: any) {
    console.error('Sync API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
