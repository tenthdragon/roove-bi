'use server';

import { createServiceSupabase } from './supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';
import { recordWarehouseActivityLog } from './warehouse-activity-log-actions';
import { getWarehouseActivityLogChangedFields } from './warehouse-activity-log-utils';
import { cleanWarehouseDomainText, normalizeWarehouseDomainText } from './warehouse-domain-helpers';

type DirectoryEntryPayload = {
  id?: number | null;
  external_name: string;
  business_id?: number | null;
  business_code: string;
  is_active?: boolean;
  notes?: string | null;
};

type OriginRegistryPayload = {
  id?: number | null;
  external_origin_business_name: string;
  external_origin_name: string;
  operator_business_id?: number | null;
  operator_business_code: string;
  internal_warehouse_code: string;
  is_active?: boolean;
  notes?: string | null;
};

function isWarehouseDomainSchemaMissingError(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function getWarehouseDomainSchemaMissingMessage() {
  return "Schema warehouse owner/origin belum terbaca oleh API Supabase. Pastikan migration 130 sudah jalan, lalu refresh schema cache dengan `NOTIFY pgrst, 'reload schema';`.";
}

async function requireMappingAccess(label: string) {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess('whs:mapping', label);
}

async function requireWarehouseRegistryAccess(label: string) {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess('whs:warehouses', label);
}

export async function getWarehouseBusinessDirectoryEntries() {
  await requireMappingAccess('Business Directory');
  const svc = createServiceSupabase();
  const [{ data: entries, error }, { data: businesses, error: businessError }] = await Promise.all([
    svc
      .from('warehouse_business_directory')
      .select('id, external_name, external_name_normalized, business_id, business_code, is_active, notes, created_at, updated_at')
      .order('external_name', { ascending: true }),
    svc
      .from('scalev_webhook_businesses')
      .select('id, business_code, business_name, is_active')
      .order('business_code', { ascending: true }),
  ]);

  if (error) {
    if (isWarehouseDomainSchemaMissingError(error)) {
      if (businessError) throw businessError;
      return {
        schema_ready: false,
        schema_message: getWarehouseDomainSchemaMissingMessage(),
        entries: [],
        businesses: businesses || [],
      };
    }
    throw error;
  }
  if (businessError) throw businessError;

  return {
    schema_ready: true,
    schema_message: null,
    entries: entries || [],
    businesses: businesses || [],
  };
}

export async function saveWarehouseBusinessDirectoryEntry(input: DirectoryEntryPayload) {
  await requireMappingAccess('Business Directory');
  const svc = createServiceSupabase();

  const externalName = cleanWarehouseDomainText(input.external_name);
  const businessCode = cleanWarehouseDomainText(input.business_code);
  if (!externalName) throw new Error('Nama external wajib diisi.');
  if (!businessCode) throw new Error('Business code wajib diisi.');

  const payload = {
    external_name: externalName,
    external_name_normalized: normalizeWarehouseDomainText(externalName),
    business_id: input.business_id == null ? null : Number(input.business_id),
    business_code: businessCode,
    is_active: input.is_active !== false,
    notes: cleanWarehouseDomainText(input.notes) || null,
  };

  const before = input.id
    ? await svc
        .from('warehouse_business_directory')
        .select('*')
        .eq('id', Number(input.id))
        .maybeSingle()
    : { data: null, error: null };
  if (before.error) {
    if (isWarehouseDomainSchemaMissingError(before.error)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw before.error;
  }

  const upsertPayload = input.id
    ? { id: Number(input.id), ...payload }
    : payload;

  const { data, error } = await svc
    .from('warehouse_business_directory')
    .upsert(upsertPayload, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) {
    if (isWarehouseDomainSchemaMissingError(error)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw error;
  }

  const beforeState = before.data || {};
  const afterState = data || {};
  const changedFields = getWarehouseActivityLogChangedFields(beforeState, afterState, [
    'external_name',
    'business_code',
    'business_id',
    'is_active',
    'notes',
  ]);

  if (changedFields.length > 0) {
    await recordWarehouseActivityLog({
      scope: 'warehouse_business_directory',
      action: before.data ? 'update' : 'create',
      screen: 'Business Directory',
      summary: before.data
        ? `Memperbarui alias business ${externalName}`
        : `Menambahkan alias business ${externalName}`,
      targetType: 'business_directory',
      targetId: String(data.id),
      targetLabel: externalName,
      businessCode,
      changedFields,
      beforeState,
      afterState,
    });
  }

  return data;
}

export async function deleteWarehouseBusinessDirectoryEntry(id: number) {
  await requireMappingAccess('Business Directory');
  const svc = createServiceSupabase();

  const { data: before, error: beforeError } = await svc
    .from('warehouse_business_directory')
    .select('*')
    .eq('id', Number(id))
    .maybeSingle();
  if (beforeError) {
    if (isWarehouseDomainSchemaMissingError(beforeError)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw beforeError;
  }
  if (!before) throw new Error('Entry business directory tidak ditemukan.');

  const { error } = await svc
    .from('warehouse_business_directory')
    .delete()
    .eq('id', Number(id));
  if (error) {
    if (isWarehouseDomainSchemaMissingError(error)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw error;
  }

  await recordWarehouseActivityLog({
    scope: 'warehouse_business_directory',
    action: 'delete',
    screen: 'Business Directory',
    summary: `Menghapus alias business ${before.external_name}`,
    targetType: 'business_directory',
    targetId: String(before.id),
    targetLabel: before.external_name,
    businessCode: before.business_code || null,
    changedFields: ['external_name', 'business_code'],
    beforeState: before,
    afterState: {},
  });

  return { success: true };
}

export async function getWarehouseOriginRegistryEntries() {
  await requireWarehouseRegistryAccess('Warehouse Registry');
  const svc = createServiceSupabase();
  const [{ data: entries, error }, { data: businesses, error: businessError }] = await Promise.all([
    svc
      .from('warehouse_origin_registry')
      .select(`
        id,
        external_origin_business_name,
        external_origin_business_name_normalized,
        external_origin_name,
        external_origin_name_normalized,
        operator_business_id,
        operator_business_code,
        internal_warehouse_code,
        is_active,
        notes,
        created_at,
        updated_at
      `)
      .order('external_origin_business_name', { ascending: true })
      .order('external_origin_name', { ascending: true }),
    svc
      .from('scalev_webhook_businesses')
      .select('id, business_code, business_name, is_active')
      .order('business_code', { ascending: true }),
  ]);

  if (error) {
    if (isWarehouseDomainSchemaMissingError(error)) {
      if (businessError) throw businessError;
      return {
        schema_ready: false,
        schema_message: getWarehouseDomainSchemaMissingMessage(),
        entries: [],
        businesses: businesses || [],
      };
    }
    throw error;
  }
  if (businessError) throw businessError;

  return {
    schema_ready: true,
    schema_message: null,
    entries: entries || [],
    businesses: businesses || [],
  };
}

export async function saveWarehouseOriginRegistryEntry(input: OriginRegistryPayload) {
  await requireWarehouseRegistryAccess('Warehouse Registry');
  const svc = createServiceSupabase();

  const externalOriginBusinessName = cleanWarehouseDomainText(input.external_origin_business_name);
  const externalOriginName = cleanWarehouseDomainText(input.external_origin_name);
  const operatorBusinessCode = cleanWarehouseDomainText(input.operator_business_code);
  const internalWarehouseCode = cleanWarehouseDomainText(input.internal_warehouse_code);

  if (!externalOriginBusinessName) throw new Error('Origin business external wajib diisi.');
  if (!externalOriginName) throw new Error('Origin external wajib diisi.');
  if (!operatorBusinessCode) throw new Error('Operator business code wajib diisi.');
  if (!internalWarehouseCode) throw new Error('Internal warehouse code wajib diisi.');

  const payload = {
    external_origin_business_name: externalOriginBusinessName,
    external_origin_business_name_normalized: normalizeWarehouseDomainText(externalOriginBusinessName),
    external_origin_name: externalOriginName,
    external_origin_name_normalized: normalizeWarehouseDomainText(externalOriginName),
    operator_business_id: input.operator_business_id == null ? null : Number(input.operator_business_id),
    operator_business_code: operatorBusinessCode,
    internal_warehouse_code: internalWarehouseCode,
    is_active: input.is_active !== false,
    notes: cleanWarehouseDomainText(input.notes) || null,
  };

  const before = input.id
    ? await svc
        .from('warehouse_origin_registry')
        .select('*')
        .eq('id', Number(input.id))
        .maybeSingle()
    : { data: null, error: null };
  if (before.error) {
    if (isWarehouseDomainSchemaMissingError(before.error)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw before.error;
  }

  const upsertPayload = input.id
    ? { id: Number(input.id), ...payload }
    : payload;

  const { data, error } = await svc
    .from('warehouse_origin_registry')
    .upsert(upsertPayload, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) {
    if (isWarehouseDomainSchemaMissingError(error)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw error;
  }

  const beforeState = before.data || {};
  const afterState = data || {};
  const changedFields = getWarehouseActivityLogChangedFields(beforeState, afterState, [
    'external_origin_business_name',
    'external_origin_name',
    'operator_business_code',
    'operator_business_id',
    'internal_warehouse_code',
    'is_active',
    'notes',
  ]);

  if (changedFields.length > 0) {
    await recordWarehouseActivityLog({
      scope: 'warehouse_origin_registry',
      action: before.data ? 'update' : 'create',
      screen: 'Warehouse Registry',
      summary: before.data
        ? `Memperbarui origin ${externalOriginBusinessName} • ${externalOriginName}`
        : `Menambahkan origin ${externalOriginBusinessName} • ${externalOriginName}`,
      targetType: 'origin_registry',
      targetId: String(data.id),
      targetLabel: `${externalOriginBusinessName} • ${externalOriginName}`,
      businessCode: operatorBusinessCode,
      changedFields,
      beforeState,
      afterState,
    });
  }

  return data;
}

export async function deleteWarehouseOriginRegistryEntry(id: number) {
  await requireWarehouseRegistryAccess('Warehouse Registry');
  const svc = createServiceSupabase();

  const { data: before, error: beforeError } = await svc
    .from('warehouse_origin_registry')
    .select('*')
    .eq('id', Number(id))
    .maybeSingle();
  if (beforeError) {
    if (isWarehouseDomainSchemaMissingError(beforeError)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw beforeError;
  }
  if (!before) throw new Error('Entry warehouse registry tidak ditemukan.');

  const { error } = await svc
    .from('warehouse_origin_registry')
    .delete()
    .eq('id', Number(id));
  if (error) {
    if (isWarehouseDomainSchemaMissingError(error)) {
      throw new Error(getWarehouseDomainSchemaMissingMessage());
    }
    throw error;
  }

  await recordWarehouseActivityLog({
    scope: 'warehouse_origin_registry',
    action: 'delete',
    screen: 'Warehouse Registry',
    summary: `Menghapus origin ${before.external_origin_business_name} • ${before.external_origin_name}`,
    targetType: 'origin_registry',
    targetId: String(before.id),
    targetLabel: `${before.external_origin_business_name} • ${before.external_origin_name}`,
    businessCode: before.operator_business_code || null,
    changedFields: ['external_origin_business_name', 'external_origin_name', 'operator_business_code', 'internal_warehouse_code'],
    beforeState: before,
    afterState: {},
  });

  return { success: true };
}
