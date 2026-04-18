// lib/webhook-actions.ts
'use server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { fetchStoreList, guessStoreType } from '@/lib/scalev-api';

// ── Auth helper: require owner role ──
async function requireOwner(label: string) {
  const { profile } = await requireDashboardRoles(['owner'], `Hanya owner yang bisa mengakses ${label}.`);
  return profile;
}

// ── List all webhook businesses ──
export async function getWebhookBusinesses() {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, is_active, api_key, tax_rate_name, created_at, updated_at')
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
      has_api_key: !!biz.api_key,
      api_key: undefined, // Never expose raw API key to client
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
  api_key?: string;
}) {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const code = input.business_code.trim().toUpperCase();
  const name = input.business_name.trim();
  const secret = input.webhook_secret.trim();
  const apiKey = (input.api_key || '').trim();

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
    if (apiKey && apiKey !== 'unchanged') {
      updateData.api_key = apiKey;
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
    const insertData: Record<string, any> = {
      business_code: code,
      business_name: name,
      webhook_secret: secret,
    };
    if (apiKey) insertData.api_key = apiKey;

    const { error } = await svc
      .from('scalev_webhook_businesses')
      .insert(insertData);

    if (error) {
      if (error.code === '23505') throw new Error(`Business code "${code}" sudah digunakan`);
      throw error;
    }

    // Auto-create warehouse mapping with default entity (first 3 chars of code)
    const defaultEntity = code.slice(0, 3);
    await svc
      .from('warehouse_business_mapping')
      .upsert({
        business_code: code,
        deduct_entity: defaultEntity,
        deduct_warehouse: 'BTN',
        is_active: true,
        is_primary: true,
        notes: 'Auto-created',
      }, { onConflict: 'business_code,deduct_entity,deduct_warehouse' });
  }

  return { success: true };
}

// ── Toggle active status ──
export async function toggleWebhookBusiness(id: number, isActive: boolean) {
  await requireOwner('Business Settings');
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
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const { error } = await svc
    .from('scalev_webhook_businesses')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

// ── List store channels for a business ──
export async function getStoreChannels(businessId: number) {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('scalev_store_channels')
    .select('id, store_name, store_type, channel_override, is_active, created_at')
    .eq('business_id', businessId)
    .order('store_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

// ── Create or update a store channel mapping ──
export async function saveStoreChannel(input: {
  id?: number;
  business_id: number;
  store_name: string;
  store_type: string;
  channel_override?: string | null;
}) {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const storeName = input.store_name.trim();
  const storeType = input.store_type.trim();
  const channelOverride = input.channel_override?.trim() || null;

  if (!storeName || !storeType) {
    throw new Error('Store name dan store type wajib diisi');
  }
  if (!['marketplace', 'scalev', 'reseller'].includes(storeType)) {
    throw new Error('Store type harus marketplace, scalev, atau reseller');
  }

  if (input.id) {
    const { error } = await svc
      .from('scalev_store_channels')
      .update({ store_name: storeName, store_type: storeType, channel_override: channelOverride })
      .eq('id', input.id);

    if (error) {
      if (error.code === '23505') throw new Error(`Store "${storeName}" sudah terdaftar di business ini`);
      throw error;
    }
  } else {
    const { error } = await svc
      .from('scalev_store_channels')
      .insert({ business_id: input.business_id, store_name: storeName, store_type: storeType, channel_override: channelOverride });

    if (error) {
      if (error.code === '23505') throw new Error(`Store "${storeName}" sudah terdaftar di business ini`);
      throw error;
    }
  }

  return { success: true };
}

// ── Toggle store channel active status ──
export async function toggleStoreChannel(id: number, isActive: boolean) {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const { error } = await svc
    .from('scalev_store_channels')
    .update({ is_active: isActive })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

// ── Delete a store channel mapping ──
export async function deleteStoreChannel(id: number) {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const { error } = await svc
    .from('scalev_store_channels')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

// ── Fetch stores from Scalev API and auto-insert ──
export async function fetchStoresFromScalev(businessId: number) {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  // Get API key for this business
  const { data: biz, error: bizErr } = await svc
    .from('scalev_webhook_businesses')
    .select('id, api_key, business_code')
    .eq('id', businessId)
    .single();

  if (bizErr || !biz) throw new Error('Business tidak ditemukan');
  if (!biz.api_key) throw new Error('API key belum diisi untuk business ini');

  // Fetch stores from Scalev API
  const stores = await fetchStoreList(biz.api_key, 'https://api.scalev.id/v2');
  const { data: existingStores, error: existingError } = await svc
    .from('scalev_store_channels')
    .select('store_name')
    .eq('business_id', businessId);

  if (existingError) throw existingError;

  const existingNames = new Set((existingStores || []).map((row) => String(row.store_name || '').toLowerCase()));

  let inserted = 0;
  let skipped = 0;

  for (const store of stores) {
    const storeName = String(store.name || '').trim();
    if (!storeName) {
      skipped++;
      continue;
    }

    if (existingNames.has(storeName.toLowerCase())) {
      skipped++;
      continue;
    }

    const storeType = guessStoreType(store.name);
    const { error } = await svc
      .from('scalev_store_channels')
      .insert({ business_id: businessId, store_name: storeName, store_type: storeType });

    if (error) {
      skipped++;
    } else {
      inserted++;
      existingNames.add(storeName.toLowerCase());
    }
  }

  return { success: true, total: stores.length, inserted, skipped };
}

export async function updateWebhookBusinessTaxRate(id: number, taxRateName: string) {
  await requireOwner('Business Settings');
  const svc = createServiceSupabase();

  const normalizedTaxRate = taxRateName.trim() || 'PPN';
  const { error } = await svc
    .from('scalev_webhook_businesses')
    .update({ tax_rate_name: normalizedTaxRate, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}
