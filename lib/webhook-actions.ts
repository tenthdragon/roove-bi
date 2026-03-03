// lib/webhook-actions.ts
'use server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';

// ── Auth helper: require owner role ──
async function requireOwner() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Hanya owner yang bisa mengelola webhook');
  return user;
}

// ── List all webhook businesses ──
export async function getWebhookBusinesses() {
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, is_active, created_at, updated_at')
    .order('business_code', { ascending: true });

  if (error) throw error;

  // For each business, get the last webhook received time from sync log
  const businesses = [];
  for (const biz of (data || [])) {
    const { data: lastSync } = await svc
      .from('scalev_sync_log')
      .select('completed_at, sync_type')
      .eq('business_code', biz.business_code)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    businesses.push({
      ...biz,
      last_webhook_at: lastSync?.completed_at || null,
      last_sync_type: lastSync?.sync_type || null,
    });
  }

  return businesses;
}

// ── Create or update a webhook business ──
export async function saveWebhookBusiness(input: {
  id?: number;
  business_code: string;
  business_name: string;
  webhook_secret: string;
}) {
  await requireOwner();
  const svc = createServiceSupabase();

  const code = input.business_code.trim().toUpperCase();
  const name = input.business_name.trim();
  const secret = input.webhook_secret.trim();

  // For new entries, all fields required. For edits, secret is optional.
  if (!code || !name) {
    throw new Error('Business code dan nama wajib diisi');
  }
  if (!input.id && !secret) {
    throw new Error('Webhook secret wajib diisi untuk business baru');
  }

  if (!/^[A-Z0-9_]{2,10}$/.test(code)) {
    throw new Error('Business code harus 2-10 karakter huruf kapital/angka');
  }

  if (input.id) {
    // Update existing — only update secret if user provided a new one
    const updateData: Record<string, any> = {
      business_code: code,
      business_name: name,
      updated_at: new Date().toISOString(),
    };

    if (secret && secret !== 'unchanged') {
      updateData.webhook_secret = secret;
    }

    const { error } = await svc
      .from('scalev_webhook_businesses')
      .update(updateData)
      .eq('id', input.id);

    if (error) {
      if (error.code === '23505') throw new Error(`Business code "${code}" sudah digunakan`);
      throw error;
    }
  } else {
    // Insert new
    const { error } = await svc
      .from('scalev_webhook_businesses')
      .insert({
        business_code: code,
        business_name: name,
        webhook_secret: secret,
      });

    if (error) {
      if (error.code === '23505') throw new Error(`Business code "${code}" sudah digunakan`);
      throw error;
    }
  }

  return { success: true };
}

// ── Toggle active status ──
export async function toggleWebhookBusiness(id: number, isActive: boolean) {
  await requireOwner();
  const svc = createServiceSupabase();

  const { error } = await svc
    .from('scalev_webhook_businesses')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

// ── Delete a webhook business ──
export async function deleteWebhookBusiness(id: number) {
  await requireOwner();
  const svc = createServiceSupabase();

  const { error } = await svc
    .from('scalev_webhook_businesses')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}
