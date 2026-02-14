import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseGoogleSheet } from '@/lib/google-sheets';

// Use direct Supabase client (not SSR) for API routes
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
    // Verify authorization - either cron secret or authenticated user
    const authHeader = req.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      // Verify user is owner via cookie-based auth
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
      if (profile?.role !== 'owner') {
        return NextResponse.json({ error: 'Only owners can sync' }, { status: 403 });
      }
    }

    const svc = getServiceSupabase();

    // Get all active sheet connections
    const { data: connections, error: connError } = await svc
      .from('sheet_connections')
      .select('*')
      .eq('is_active', true);

    if (connError) throw connError;
    if (!connections || connections.length === 0) {
      return NextResponse.json({ message: 'No active sheet connections', synced: 0 });
    }

    const results = [];

    for (const conn of connections) {
      try {
        console.log(`Syncing spreadsheet: ${conn.spreadsheet_id} (${conn.label})`);

        // Parse Google Sheet
        const parsed = await parseGoogleSheet(conn.spreadsheet_id);

        if (!parsed.period.month || !parsed.period.year) {
          results.push({
            spreadsheet_id: conn.spreadsheet_id,
            label: conn.label,
            success: false,
            error: 'Could not detect period from sheet',
          });
          continue;
        }

        // Delete existing data for this period
        const periodStart = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-01`;
        const lastDay = new Date(parsed.period.year, parsed.period.month, 0).getDate();
        const periodEnd = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

        const del1 = await svc.from('daily_product_summary').delete()
          .gte('date', periodStart).lte('date', periodEnd);
        if (del1.error) throw new Error(`Delete daily_product_summary: ${del1.error.message}`);

        const del2 = await svc.from('daily_channel_data').delete()
          .gte('date', periodStart).lte('date', periodEnd);
        if (del2.error) throw new Error(`Delete daily_channel_data: ${del2.error.message}`);

        const del3 = await svc.from('daily_ads_spend').delete()
          .gte('date', periodStart).lte('date', periodEnd);
        if (del3.error) throw new Error(`Delete daily_ads_spend: ${del3.error.message}`);

        const del4 = await svc.from('monthly_product_summary').delete()
          .eq('period_month', parsed.period.month)
          .eq('period_year', parsed.period.year);
        if (del4.error) throw new Error(`Delete monthly_product_summary: ${del4.error.message}`);

        // Create/update import record
        await svc.from('data_imports').upsert({
          filename: `gsheet:${conn.spreadsheet_id}`,
          period_month: parsed.period.month,
          period_year: parsed.period.year,
          imported_by: conn.created_by,
          row_count: parsed.dailyProduct.length + parsed.dailyChannel.length + parsed.ads.length,
          status: 'processing',
          notes: `Auto-sync from Google Sheet: ${conn.label}`,
        }, { onConflict: 'period_month,period_year,filename' });

        // Insert daily product data
        if (parsed.dailyProduct.length > 0) {
          const { error } = await svc.from('daily_product_summary').insert(parsed.dailyProduct);
          if (error) throw error;
        }

        // Insert daily channel data (batched)
        if (parsed.dailyChannel.length > 0) {
          for (let i = 0; i < parsed.dailyChannel.length; i += 500) {
            const batch = parsed.dailyChannel.slice(i, i + 500);
            const { error } = await svc.from('daily_channel_data').insert(batch);
            if (error) throw error;
          }
        }

        // Insert ads data (batched)
        if (parsed.ads.length > 0) {
          for (let i = 0; i < parsed.ads.length; i += 500) {
            const batch = parsed.ads.slice(i, i + 500);
            const { error } = await svc.from('daily_ads_spend').insert(batch);
            if (error) throw error;
          }
        }

        // Insert monthly summary
        if (parsed.monthlySummary.length > 0) {
          const rows = parsed.monthlySummary.map(d => ({
            ...d,
            period_month: parsed.period.month,
            period_year: parsed.period.year,
          }));
          const { error } = await svc.from('monthly_product_summary').insert(rows);
          if (error) throw error;
        }

        // Mark import as completed
        await svc.from('data_imports').update({
          status: 'completed',
          row_count: parsed.dailyProduct.length + parsed.dailyChannel.length + parsed.ads.length,
        }).eq('filename', `gsheet:${conn.spreadsheet_id}`)
          .eq('period_month', parsed.period.month)
          .eq('period_year', parsed.period.year);

        // Update last_synced on connection
        await svc.from('sheet_connections').update({
          last_synced: new Date().toISOString(),
          last_sync_status: 'success',
          last_sync_message: `Synced ${parsed.dailyProduct.length} product rows, ${parsed.ads.length} ad rows`,
        }).eq('id', conn.id);

        results.push({
          spreadsheet_id: conn.spreadsheet_id,
          label: conn.label,
          success: true,
          period: parsed.period,
          counts: {
            dailyProduct: parsed.dailyProduct.length,
            dailyChannel: parsed.dailyChannel.length,
            ads: parsed.ads.length,
            monthlySummary: parsed.monthlySummary.length,
          },
        });
      } catch (err: any) {
        console.error(`Sync failed for ${conn.spreadsheet_id}:`, err);

        // Update connection with error
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
