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
  // Call our own API endpoint
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

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
