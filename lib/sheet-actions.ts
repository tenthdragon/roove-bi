'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';
import { testSheetConnection } from './google-sheets';

export async function fetchSheetConnections() {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('sheet_connections')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function addSheetConnection(spreadsheetId: string, label: string) {
  const supabase = createServerSupabase();

  // Verify user is owner
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Only owners can manage sheet connections');

  // Test connection first
  const test = await testSheetConnection(spreadsheetId);
  if (!test.success) {
    throw new Error(`Cannot access spreadsheet: ${test.error}. Make sure you shared it with the service account email.`);
  }

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('sheet_connections')
    .insert({
      spreadsheet_id: spreadsheetId,
      label,
      is_active: true,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeSheetConnection(connectionId: string) {
  const supabase = createServerSupabase();

  // Verify user is owner
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Only owners can manage sheet connections');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('sheet_connections')
    .delete()
    .eq('id', connectionId);

  if (error) throw error;
  return { success: true };
}

export async function toggleSheetConnection(connectionId: string, isActive: boolean) {
  const supabase = createServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Only owners can manage sheet connections');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('sheet_connections')
    .update({ is_active: isActive })
    .eq('id', connectionId);

  if (error) throw error;
  return { success: true };
}

export async function triggerSync() {
  const { createServiceSupabase } = await import('./supabase-server');
  const { parseGoogleSheet } = await import('./google-sheets');
  
  const svc = createServiceSupabase();

  const { data: connections, error: connError } = await svc
    .from('sheet_connections')
    .select('*')
    .eq('is_active', true);

  if (connError) throw connError;
  if (!connections || connections.length === 0) {
    return { message: 'No active sheet connections', synced: 0, failed: 0, results: [] };
  }

  const results = [];

  for (const conn of connections) {
    try {
      const parsed = await parseGoogleSheet(conn.spreadsheet_id);

      if (!parsed.period.month || !parsed.period.year) {
        results.push({ label: conn.label, success: false, error: 'Could not detect period' });
        continue;
      }

      const periodStart = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-01`;
      const lastDay = new Date(parsed.period.year, parsed.period.month, 0).getDate();
      const periodEnd = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      const del1 = await svc.from('daily_product_summary').delete().gte('date', periodStart).lte('date', periodEnd);
      if (del1.error) throw new Error(`Delete daily_product_summary: ${del1.error.message}`);
      const del2 = await svc.from('daily_channel_data').delete().gte('date', periodStart).lte('date', periodEnd);
      if (del2.error) throw new Error(`Delete daily_channel_data: ${del2.error.message}`);
      const del3 = await svc.from('daily_ads_spend').delete().gte('date', periodStart).lte('date', periodEnd);
      if (del3.error) throw new Error(`Delete daily_ads_spend: ${del3.error.message}`);
      const del4 = await svc.from('monthly_product_summary').delete().eq('period_month', parsed.period.month).eq('period_year', parsed.period.year);
      if (del4.error) throw new Error(`Delete monthly_product_summary: ${del4.error.message}`);

      if (parsed.dailyProduct.length > 0) {
        const { error } = await svc.from('daily_product_summary').insert(parsed.dailyProduct);
        if (error) throw error;
      }
      if (parsed.dailyChannel.length > 0) {
        for (let i = 0; i < parsed.dailyChannel.length; i += 500) {
          const { error } = await svc.from('daily_channel_data').insert(parsed.dailyChannel.slice(i, i + 500));
          if (error) throw error;
        }
      }
      if (parsed.ads.length > 0) {
        for (let i = 0; i < parsed.ads.length; i += 500) {
          const { error } = await svc.from('daily_ads_spend').insert(parsed.ads.slice(i, i + 500));
          if (error) throw error;
        }
      }
      if (parsed.monthlySummary.length > 0) {
        const rows = parsed.monthlySummary.map(d => ({ ...d, period_month: parsed.period.month, period_year: parsed.period.year }));
        const { error } = await svc.from('monthly_product_summary').insert(rows);
        if (error) throw error;
      }

      await svc.from('sheet_connections').update({
        last_synced: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_message: `Synced ${parsed.dailyProduct.length} product, ${parsed.ads.length} ads`,
      }).eq('id', conn.id);

      results.push({ label: conn.label, success: true, period: parsed.period });
    } catch (err: any) {
      await svc.from('sheet_connections').update({
        last_synced: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_message: err.message || 'Unknown error',
      }).eq('id', conn.id);
      results.push({ label: conn.label, success: false, error: err.message });
    }
  }

  return { synced: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results };
}

  const res = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Sync failed');
  }

  return res.json();
}
