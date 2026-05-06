'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess } from './dashboard-access';
import { testSheetConnection } from './google-sheets';

async function requireDailyAdminAccess(label: string) {
  return requireDashboardPermissionAccess('admin:daily', label);
}

function toActionError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return new Error(error.message);
  }
  return new Error(fallback);
}

function normalizeSpreadsheetId(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';

  const urlMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return urlMatch?.[1] || value;
}

export async function fetchSheetConnections() {
  await requireDailyAdminAccess('Admin Daily Data');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('sheet_connections')
    .select('*')
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw toActionError(error, 'Gagal memuat koneksi spreadsheet.');
  return data;
}

async function deactivateOtherSheetConnections(targetId: string) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('sheet_connections')
    .update({ is_active: false })
    .neq('id', targetId)
    .eq('is_active', true);

  if (error) {
    throw toActionError(error, 'Gagal menonaktifkan koneksi spreadsheet lain.');
  }
}

export async function addSheetConnection(spreadsheetId: string, label: string) {
  const { profile } = await requireDailyAdminAccess('Admin Daily Data');
  const normalizedSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);
  const normalizedLabel = String(label || '').trim();

  if (!normalizedSpreadsheetId) {
    throw new Error('Spreadsheet ID wajib diisi.');
  }
  if (!normalizedLabel) {
    throw new Error('Label wajib diisi.');
  }

  const test = await testSheetConnection(normalizedSpreadsheetId);
  if (!test.success) {
    throw new Error(`Cannot access spreadsheet: ${test.error}. Make sure you shared it with the service account email.`);
  }

  const svc = createServiceSupabase();

  const { data: existing, error: existingError } = await svc
    .from('sheet_connections')
    .select('id, spreadsheet_id, label, is_active')
    .eq('spreadsheet_id', normalizedSpreadsheetId)
    .maybeSingle();
  if (existingError) throw toActionError(existingError, 'Gagal memeriksa spreadsheet yang sudah terhubung.');

  const { data: activeConnection, error: activeConnectionError } = await svc
    .from('sheet_connections')
    .select('id, spreadsheet_id')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeConnectionError) throw toActionError(activeConnectionError, 'Gagal memeriksa spreadsheet aktif.');

  if (existing) {
    const { data: updated, error: updateError } = await svc
      .from('sheet_connections')
      .update({
        label: normalizedLabel,
        is_active: true,
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (updateError) throw toActionError(updateError, 'Gagal memperbarui koneksi spreadsheet.');
    await deactivateOtherSheetConnections(existing.id);
    return updated;
  }

  if (activeConnection) {
    const { data: updated, error: updateError } = await svc
      .from('sheet_connections')
      .update({
        spreadsheet_id: normalizedSpreadsheetId,
        label: normalizedLabel,
        is_active: true,
      })
      .eq('id', activeConnection.id)
      .select()
      .single();

    if (updateError) throw toActionError(updateError, 'Gagal memperbarui spreadsheet aktif.');
    await deactivateOtherSheetConnections(activeConnection.id);
    return updated;
  }

  const { data, error } = await svc
    .from('sheet_connections')
    .insert({
      spreadsheet_id: normalizedSpreadsheetId,
      label: normalizedLabel,
      is_active: true,
      created_by: profile.id,
    })
    .select()
    .single();

  if (error) throw toActionError(error, 'Gagal menambahkan koneksi spreadsheet.');
  await deactivateOtherSheetConnections(data.id);
  return data;
}

export async function removeSheetConnection(connectionId: string) {
  await requireDailyAdminAccess('Admin Daily Data');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('sheet_connections')
    .delete()
    .eq('id', connectionId);
  if (error) throw toActionError(error, 'Gagal menghapus koneksi spreadsheet.');
  return { success: true };
}

export async function toggleSheetConnection(connectionId: string, isActive: boolean) {
  await requireDailyAdminAccess('Admin Daily Data');

  const svc = createServiceSupabase();
  if (isActive) {
    await deactivateOtherSheetConnections(connectionId);
  }
  const { error } = await svc
    .from('sheet_connections')
    .update({ is_active: isActive })
    .eq('id', connectionId);
  if (error) throw toActionError(error, 'Gagal mengubah status koneksi spreadsheet.');
  return { success: true };
}

// NOTE: triggerSync() has been removed.
// All sync operations now go through the unified API route at /api/sync.
// This eliminates duplicated logic and ensures brandList is always fetched.
// See SheetManager.tsx handleSync() which calls the API route directly.
