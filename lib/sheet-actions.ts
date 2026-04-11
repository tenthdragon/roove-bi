'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess } from './dashboard-access';
import { testSheetConnection } from './google-sheets';

async function requireDailyAdminAccess(label: string) {
  await requireDashboardPermissionAccess('admin:daily', label);
}

export async function fetchSheetConnections() {
  await requireDailyAdminAccess('Admin Daily Data');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('sheet_connections')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addSheetConnection(spreadsheetId: string, label: string) {
  const { profile } = await requireDailyAdminAccess('Admin Daily Data');

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
      created_by: profile.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function removeSheetConnection(connectionId: string) {
  await requireDailyAdminAccess('Admin Daily Data');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('sheet_connections')
    .delete()
    .eq('id', connectionId);
  if (error) throw error;
  return { success: true };
}

export async function toggleSheetConnection(connectionId: string, isActive: boolean) {
  await requireDailyAdminAccess('Admin Daily Data');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('sheet_connections')
    .update({ is_active: isActive })
    .eq('id', connectionId);
  if (error) throw error;
  return { success: true };
}

// NOTE: triggerSync() has been removed.
// All sync operations now go through the unified API route at /api/sync.
// This eliminates duplicated logic and ensures brandList is always fetched.
// See SheetManager.tsx handleSync() which calls the API route directly.
