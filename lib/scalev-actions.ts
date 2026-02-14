// lib/scalev-actions.ts
'use server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';

// ── Get Scalev integration status ──
export async function getScalevStatus() {
  try {
    const svc = createServiceSupabase();

    const { data: config } = await svc
      .from('scalev_config')
      .select('id, base_url, is_active, last_sync_id, updated_at')
      .eq('is_active', true)
      .single();

    const { count: totalOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true });

    const { count: shippedOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true })
      .not('shipped_time', 'is', null);

    const { data: lastSync } = await svc
      .from('scalev_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentSyncs } = await svc
      .from('scalev_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(5);

    return {
      configured: !!config,
      configId: config?.id || null,
      lastSyncId: config?.last_sync_id || 0,
      totalOrders: totalOrders || 0,
      shippedOrders: shippedOrders || 0,
      lastSync: lastSync || null,
      recentSyncs: recentSyncs || [],
    };
  } catch (err: any) {
    console.error('getScalevStatus error:', err.message);
    return {
      configured: false,
      configId: null,
      lastSyncId: 0,
      totalOrders: 0,
      shippedOrders: 0,
      lastSync: null,
      recentSyncs: [],
    };
  }
}

// ── Save Scalev API key (owner only) ──
export async function saveScalevApiKey(apiKey: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Only owners can configure Scalev');

  const svc = createServiceSupabase();

  await svc.from('scalev_config').update({ is_active: false }).eq('is_active', true);

  const { error } = await svc.from('scalev_config').insert({
    api_key: apiKey,
    base_url: 'https://api.scalev.id/v2',
    is_active: true,
    last_sync_id: 0,
  });

  if (error) throw error;
  return { success: true };
}

// ── Trigger manual sync (owner only) ──
export async function triggerScalevSync(mode: 'incremental' | 'full' = 'incremental') {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const res = await fetch(`${baseUrl}/api/scalev-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ mode }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sync failed: ${text}`);
  }

  return await res.json();
}

// ── Get daily order summary (for dashboard) ──
export async function fetchScalevDailySummary(from: string, to: string) {
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('v_daily_order_summary')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}

// ── Get daily channel summary (for dashboard) ──
export async function fetchScalevChannelSummary(from: string, to: string) {
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('v_daily_channel_summary')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}
