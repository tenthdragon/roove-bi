'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';

export interface Brand {
  id: number;
  name: string;
  sheet_name: string;
  is_active: boolean;
  created_at: string;
}

// ── Fetch all brands (active + inactive) ──
export async function fetchAllBrands(): Promise<Brand[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data as Brand[];
}

// ── Fetch only active brands ──
export async function fetchActiveBrands(): Promise<Brand[]> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return data as Brand[];
}

// ── Fetch active brand names (lightweight, for dashboard filtering) ──
export async function fetchActiveBrandNames(): Promise<string[]> {
  const brands = await fetchActiveBrands();
  return brands.map(b => b.name);
}

// ── Add a new brand ──
export async function addBrand(name: string, sheetName: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createServerSupabase();

  // Verify caller is owner
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'owner') throw new Error('Only owners can manage brands');

  const svc = createServiceSupabase();

  // Check for case-insensitive duplicate
  const { data: existing } = await svc
    .from('brands')
    .select('id, name')
    .ilike('name', name);

  if (existing && existing.length > 0) {
    return { success: false, error: `Brand "${existing[0].name}" sudah ada` };
  }

  // Check for sheet_name duplicate
  const { data: existingSheet } = await svc
    .from('brands')
    .select('id, name, sheet_name')
    .ilike('sheet_name', sheetName);

  if (existingSheet && existingSheet.length > 0) {
    return { success: false, error: `Sheet "${sheetName}" sudah digunakan oleh brand "${existingSheet[0].name}"` };
  }

  const { error } = await svc
    .from('brands')
    .insert({ name: name.trim(), sheet_name: sheetName.trim() });

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return { success: false, error: 'Brand dengan nama ini sudah ada' };
    }
    throw error;
  }

  return { success: true };
}

// ── Toggle brand active/inactive ──
export async function toggleBrand(brandId: number, isActive: boolean): Promise<void> {
  const supabase = createServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'owner') throw new Error('Only owners can manage brands');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('brands')
    .update({ is_active: isActive })
    .eq('id', brandId);

  if (error) throw error;
}

// ── Permanently delete brand + all its data ──
export async function deleteBrandPermanently(brandId: number): Promise<{ success: boolean; deleted: Record<string, number> }> {
  const supabase = createServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'owner') throw new Error('Only owners can manage brands');

  const svc = createServiceSupabase();

  // Get brand name first
  const { data: brand } = await svc.from('brands').select('name').eq('id', brandId).single();
  if (!brand) throw new Error('Brand not found');

  const brandName = brand.name;
  const deleted: Record<string, number> = {};

  // Delete from daily_product_summary
  const { count: c1 } = await svc.from('daily_product_summary')
    .delete({ count: 'exact' }).eq('product', brandName);
  deleted['daily_product_summary'] = c1 || 0;

  // Delete from daily_channel_data
  const { count: c2 } = await svc.from('daily_channel_data')
    .delete({ count: 'exact' }).eq('product', brandName);
  deleted['daily_channel_data'] = c2 || 0;

  // Delete from monthly_product_summary
  const { count: c3 } = await svc.from('monthly_product_summary')
    .delete({ count: 'exact' }).eq('product', brandName);
  deleted['monthly_product_summary'] = c3 || 0;

  // Finally delete the brand record
  const { error } = await svc.from('brands').delete().eq('id', brandId);
  if (error) throw error;

  return { success: true, deleted };
}
