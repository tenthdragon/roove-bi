'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess, requireDashboardRoles, requireDashboardTabAccess } from './dashboard-access';
import { parseRooveExcel } from './excel-parser';
import type { Profile, DailyProductSummary, MonthlyProductSummary } from './utils';

// ── Auth & Profile ──

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const directProfile = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (directProfile.data) return directProfile.data as Profile;

  const { data } = await supabase
    .rpc('get_my_dashboard_profile')
    .maybeSingle();

  return data as Profile | null;
}

// ── Dashboard Data Queries ──

export async function fetchDailyProductSummary(from: string, to: string) {
  const { workspaceId } = await requireDashboardTabAccess('overview', 'Overview');

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_product_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data as DailyProductSummary[];
}

export async function fetchDailyChannelData(from: string, to: string) {
  const { workspaceId } = await requireDashboardTabAccess('channels', 'Sales Channel');

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_channel_data')
    .select('date, product, channel, net_sales, gross_profit')
    .eq('workspace_id', workspaceId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}

export async function fetchDailyAdsSpend(from: string, to: string) {
  const { workspaceId } = await requireDashboardTabAccess('marketing', 'Marketing');

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('daily_ads_spend')
    .select('date, ad_account, spent, source, store')
    .eq('workspace_id', workspaceId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}

export async function fetchMonthlySummary(month: number, year: number) {
  const { workspaceId } = await requireDashboardTabAccess('overview', 'Overview');

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('monthly_product_summary')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('period_month', month)
    .eq('period_year', year)
    .order('sales_after_disc', { ascending: false });

  if (error) throw error;
  return data as MonthlyProductSummary[];
}

export async function fetchAvailablePeriods() {
  const { workspaceId } = await requireDashboardTabAccess('overview', 'Overview');

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('data_imports')
    .select('period_month, period_year, imported_at, filename')
    .eq('workspace_id', workspaceId)
    .eq('status', 'completed')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });

  if (error) throw error;
  return data;
}

export async function fetchDateRange() {
  const { workspaceId } = await requireDashboardTabAccess('overview', 'Overview');

  const supabase = createServerSupabase();

  const { data } = await supabase
    .from('daily_product_summary')
    .select('date')
    .eq('workspace_id', workspaceId)
    .order('date', { ascending: true })
    .limit(1);

  const { data: lastData } = await supabase
    .from('daily_product_summary')
    .select('date')
    .eq('workspace_id', workspaceId)
    .order('date', { ascending: false })
    .limit(1);

  return {
    earliest: data?.[0]?.date || null,
    latest: lastData?.[0]?.date || null,
  };
}

// ── Upload & Import ──

export async function uploadExcelData(formData: FormData) {
  const { profile, workspaceId } = await requireDashboardPermissionAccess(
    'admin:daily',
    'Admin Daily Data',
  );

  const file = formData.get('file') as File;
  if (!file) throw new Error('No file provided');

  const buffer = await file.arrayBuffer();

  // ── Read active brands from database ──
  const svc = createServiceSupabase();
  const { data: brands, error: brandsError } = await svc
    .from('brands')
    .select('name, sheet_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);

  if (brandsError) throw brandsError;

  const parsed = parseRooveExcel(buffer, brands || []);

  if (!parsed.period.month || !parsed.period.year) {
    throw new Error('Could not detect period from file. Make sure the file has date columns.');
  }

  // Create import record
  const { data: importRecord, error: importError } = await svc
    .from('data_imports')
    .upsert({
      workspace_id: workspaceId,
      filename: file.name,
      period_month: parsed.period.month,
      period_year: parsed.period.year,
      imported_by: profile.id,
      row_count: parsed.dailyProduct.length,
      status: 'processing',
    }, { onConflict: 'workspace_id,period_month,period_year,filename' })
    .select()
    .single();

  if (importError) throw importError;
  const importId = importRecord.id;

  try {
    // Delete existing data for this period
    const periodStart = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-01`;
    const lastDay = new Date(parsed.period.year, parsed.period.month, 0).getDate();
    const periodEnd = `${parsed.period.year}-${String(parsed.period.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const del1 = await svc.from('summary_daily_product_complete').delete()
      .eq('workspace_id', workspaceId)
      .gte('date', periodStart).lte('date', periodEnd);
    if (del1.error) throw new Error(`Delete summary_daily_product_complete failed: ${del1.error.message}`);

    const del2 = await svc.from('summary_daily_channel_complete').delete()
      .eq('workspace_id', workspaceId)
      .gte('date', periodStart).lte('date', periodEnd);
    if (del2.error) throw new Error(`Delete summary_daily_channel_complete failed: ${del2.error.message}`);

    const del3 = await svc.from('daily_ads_spend').delete()
      .eq('workspace_id', workspaceId)
      .gte('date', periodStart).lte('date', periodEnd);
    if (del3.error) throw new Error(`Delete daily_ads_spend failed: ${del3.error.message}`);

    const del4 = await svc.from('monthly_product_summary').delete()
      .eq('workspace_id', workspaceId)
      .eq('period_month', parsed.period.month)
      .eq('period_year', parsed.period.year);
    if (del4.error) throw new Error(`Delete monthly_product_summary failed: ${del4.error.message}`);

    // Insert daily product data
    if (parsed.dailyProduct.length > 0) {
      const rows = parsed.dailyProduct.map(d => ({
        ...d,
        workspace_id: workspaceId,
        import_id: importId,
      }));
      const { error } = await svc.from('summary_daily_product_complete').insert(rows);
      if (error) throw error;
    }

    // Insert daily channel data
    if (parsed.dailyChannel.length > 0) {
      const rows = parsed.dailyChannel.map(d => ({
        ...d,
        workspace_id: workspaceId,
        import_id: importId,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await svc.from('summary_daily_channel_complete').insert(batch);
        if (error) throw error;
      }
    }

    // Insert ads data
    if (parsed.ads.length > 0) {
      const rows = parsed.ads.map(d => ({
        ...d,
        workspace_id: workspaceId,
        import_id: importId,
      }));
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
        workspace_id: workspaceId,
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
    }).eq('id', importId)
      .eq('workspace_id', workspaceId);

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
    await svc.from('data_imports').update({
      status: 'failed',
      notes: String(err)
    }).eq('id', importId)
      .eq('workspace_id', workspaceId);
    throw err;
  }
}

// ── User Management ──

export async function fetchAllUsers() {
  const { workspaceId } = await requireDashboardRoles(
    ['owner'],
    'Hanya owner yang bisa mengakses daftar user.',
  );

  const svc = createServiceSupabase();
  const { data: memberships, error: membershipsError } = await svc
    .from('workspace_memberships')
    .select('user_id, role, created_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (membershipsError) throw membershipsError;

  const memberIds = (memberships || []).map((membership) => membership.user_id);
  if (memberIds.length === 0) return [];

  const { data, error } = await svc
    .from('profiles')
    .select('*')
    .in('id', memberIds);
  if (error) throw error;

  const roleByUser = new Map(
    (memberships || []).map((membership) => [
      membership.user_id,
      membership.role === 'workspace_owner' ? 'owner' : membership.role,
    ]),
  );
  return (data || [])
    .map((profile) => ({
      ...profile,
      role: roleByUser.get(profile.id) || profile.role,
    }))
    .sort(
      (a, b) =>
        memberIds.indexOf(a.id) - memberIds.indexOf(b.id),
    ) as Profile[];
}

export async function updateUserRole(userId: string, role: string, allowedTabs: string[], allowedProducts: string[]) {
  const { workspaceId } = await requireDashboardRoles(
    ['owner'],
    'Hanya owner workspace yang bisa mengubah role user.',
  );
  const membershipRole = role === 'owner' ? 'workspace_owner' : role;

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('workspace_memberships')
    .update({
      role: membershipRole,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw error;
  void allowedTabs;
  void allowedProducts;
  return { success: true };
}
