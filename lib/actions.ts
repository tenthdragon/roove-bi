'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';
import { parseRooveExcel } from './excel-parser';
import type { Profile, DailyProductSummary, MonthlyProductSummary } from './utils';

// ── Auth & Profile ──
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return data as Profile | null;
}

// ── Dashboard Data Queries ──
export async function fetchDailyProductSummary(from: string, to: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_product_summary')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data as DailyProductSummary[];
}

export async function fetchDailyChannelData(from: string, to: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_channel_data')
    .select('date, product, channel, net_sales, gross_profit')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}

export async function fetchDailyAdsSpend(from: string, to: string) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_ads_spend')
    .select('date, ad_account, spent, source, store')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}

export async function fetchMonthlySummary(month: number, year: number) {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('monthly_product_summary')
    .select('*')
    .eq('period_month', month)
    .eq('period_year', year)
    .order('sales_after_disc', { ascending: false });

  if (error) throw error;
  return data as MonthlyProductSummary[];
}

export async function fetchAvailablePeriods() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('data_imports')
    .select('period_month, period_year, imported_at, filename')
    .eq('status', 'completed')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });

  if (error) throw error;
  return data;
}

export async function fetchDateRange() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_product_summary')
    .select('date')
    .order('date', { ascending: true })
    .limit(1);

  const { data: lastData } = await supabase
    .from('daily_product_summary')
    .select('date')
    .order('date', { ascending: false })
    .limit(1);

  return {
    earliest: data?.[0]?.date || null,
    latest: lastData?.[0]?.date || null,
  };
}

// ── Upload & Import ──
export async function uploadExcelData(formData: FormData) {
  const supabase = createServerSupabase();

  // Verify user is owner
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Only owners can upload data');

  const file = formData.get('file') as File;
  if (!file) throw new Error('No file provided');

  const buffer = await file.arrayBuffer();
  const parsed = parseRooveExcel(buffer);

  if (!parsed.period.month || !parsed.period.year) {
    throw new Error('Could not detect period from file. Make sure the file has date columns.');
  }

  // Use service role for bulk insert (bypasses RLS for performance)
  const svc = createServiceSupabase();

  // Create import record
  const { data: importRecord, error: importError } = await svc
    .from('data_imports')
    .upsert({
      filename: file.name,
      period_month: parsed.period.month,
      period_year: parsed.period.year,
      imported_by: user.id,
      row_count: parsed.dailyProduct.length,
      status: 'processing',
    }, { onConflict: 'period_month,period_year,filename' })
    .select()
    .single();

  if (importError) throw importError;
  const importId = importRecord.id;

  try {
    // Delete existing data for this period (to allow re-imports)
    const periodStart = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-01`;
    const periodEnd = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-31`;

    await svc.from('daily_product_summary').delete()
      .gte('date', periodStart).lte('date', periodEnd);
    await svc.from('daily_channel_data').delete()
      .gte('date', periodStart).lte('date', periodEnd);
    await svc.from('daily_ads_spend').delete()
      .gte('date', periodStart).lte('date', periodEnd);
    await svc.from('monthly_product_summary').delete()
      .eq('period_month', parsed.period.month)
      .eq('period_year', parsed.period.year);

    // Insert daily product data
    if (parsed.dailyProduct.length > 0) {
      const rows = parsed.dailyProduct.map(d => ({ ...d, import_id: importId }));
      const { error } = await svc.from('daily_product_summary').insert(rows);
      if (error) throw error;
    }

    // Insert daily channel data
    if (parsed.dailyChannel.length > 0) {
      const rows = parsed.dailyChannel.map(d => ({ ...d, import_id: importId }));
      // Insert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await svc.from('daily_channel_data').insert(batch);
        if (error) throw error;
      }
    }

    // Insert ads data
    if (parsed.ads.length > 0) {
      const rows = parsed.ads.map(d => ({ ...d, import_id: importId }));
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
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
        import_id: importId,
      }));
      const { error } = await svc.from('monthly_product_summary').insert(rows);
      if (error) throw error;
    }

    // Mark import as completed
    await svc.from('data_imports').update({
      status: 'completed',
      row_count: parsed.dailyProduct.length + parsed.dailyChannel.length + parsed.ads.length,
    }).eq('id', importId);

    return {
      success: true,
      period: parsed.period,
      counts: {
        dailyProduct: parsed.dailyProduct.length,
        dailyChannel: parsed.dailyChannel.length,
        ads: parsed.ads.length,
        monthlySummary: parsed.monthlySummary.length,
      },
    };
  } catch (err) {
    await svc.from('data_imports').update({ status: 'failed', notes: String(err) }).eq('id', importId);
    throw err;
  }
}

// ── User Management ──
export async function fetchAllUsers() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data as Profile[];
}

export async function updateUserRole(userId: string, role: string, allowedTabs: string[], allowedProducts: string[]) {
  const supabase = createServerSupabase();

  // Verify caller is owner
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Only owners can manage users');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('profiles')
    .update({
      role,
      allowed_tabs: allowedTabs,
      allowed_products: allowedProducts,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) throw error;
  return { success: true };
}
