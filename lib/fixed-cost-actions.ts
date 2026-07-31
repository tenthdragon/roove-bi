'use server';

import { createServiceSupabase } from './supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';

export type FixedCostRecurrence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export type FixedCostInput = {
  id?: number | null;
  categoryId?: number | null;
  name: string;
  amount: number;
  quantity: number;
  costUnit: string;
  recurrenceUnit: FixedCostRecurrence;
  recurrenceInterval: number;
  startDate: string;
  endDate?: string | null;
  dueDay?: number | null;
  notes?: string | null;
  isActive?: boolean;
};

function cleanText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function monthlyEquivalent(item: {
  amount: number;
  quantity: number;
  recurrence_unit: FixedCostRecurrence;
  recurrence_interval: number;
}) {
  const factor = {
    daily: 365 / 12,
    weekly: 52 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
  }[item.recurrence_unit] || 1;

  return (Number(item.amount) || 0)
    * (Number(item.quantity) || 1)
    * factor
    / Math.max(Number(item.recurrence_interval) || 1, 1);
}

export async function getFixedCostBootstrap() {
  const { workspaceId } = await requireDashboardTabAccess('fixed-costs', 'Fixed Costs');
  const svc = createServiceSupabase();

  const [categoriesResult, itemsResult] = await Promise.all([
    svc
      .from('fixed_cost_categories')
      .select('id, name, description, sort_order, is_active')
      .eq('workspace_id', workspaceId)
      .order('sort_order')
      .order('name'),
    svc
      .from('fixed_cost_items')
      .select('id, category_id, name, amount, quantity, cost_unit, recurrence_unit, recurrence_interval, start_date, end_date, due_day, notes, is_active, updated_at')
      .eq('workspace_id', workspaceId)
      .order('is_active', { ascending: false })
      .order('name'),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const items = (itemsResult.data || []).map((item: any) => ({
    ...item,
    amount: Number(item.amount || 0),
    quantity: Number(item.quantity || 0),
    recurrence_interval: Number(item.recurrence_interval || 1),
    monthly_equivalent: monthlyEquivalent(item),
  }));

  return {
    categories: categoriesResult.data || [],
    items,
    summary: {
      activeMonthly: items
        .filter((item: any) => item.is_active)
        .reduce((sum: number, item: any) => sum + item.monthly_equivalent, 0),
      activeItems: items.filter((item: any) => item.is_active).length,
      totalItems: items.length,
    },
  };
}

async function requireManageFixedCosts() {
  return requireDashboardPermissionAccess('admin:financial', 'Kelola Fixed Costs');
}

export async function createFixedCostCategory(name: string) {
  const { workspaceId } = await requireManageFixedCosts();
  const cleanName = cleanText(name);
  if (!cleanName) throw new Error('Nama kategori wajib diisi.');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('fixed_cost_categories')
    .insert({ workspace_id: workspaceId, name: cleanName })
    .select('id, name, description, sort_order, is_active')
    .single();

  if (error) throw error;
  return data;
}

export async function saveFixedCost(input: FixedCostInput) {
  const { workspaceId, profile } = await requireManageFixedCosts();
  const name = cleanText(input.name);
  const amount = Number(input.amount);
  const quantity = Number(input.quantity);
  const recurrenceInterval = Number(input.recurrenceInterval);
  const dueDay = input.dueDay == null ? null : Number(input.dueDay);
  const endDate = cleanText(input.endDate);

  if (!name) throw new Error('Nama biaya wajib diisi.');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Nominal biaya tidak valid.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Jumlah unit harus lebih dari nol.');
  if (!Number.isInteger(recurrenceInterval) || recurrenceInterval <= 0) {
    throw new Error('Interval pengeluaran tidak valid.');
  }
  if (!['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(input.recurrenceUnit)) {
    throw new Error('Frekuensi pengeluaran tidak valid.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '')) {
    throw new Error('Tanggal mulai wajib diisi.');
  }
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Tanggal berakhir tidak valid.');
  }
  if (endDate && endDate < input.startDate) {
    throw new Error('Tanggal berakhir tidak boleh sebelum tanggal mulai.');
  }
  if (
    dueDay !== null
    && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
  ) {
    throw new Error('Tanggal jatuh tempo harus berupa angka 1–31.');
  }

  const categoryId = input.categoryId ? Number(input.categoryId) : null;
  const svc = createServiceSupabase();
  if (categoryId !== null) {
    const { data: category, error: categoryError } = await svc
      .from('fixed_cost_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (categoryError) throw categoryError;
    if (!category) throw new Error('Kategori tidak tersedia di workspace aktif.');
  }

  const payload = {
    workspace_id: workspaceId,
    category_id: categoryId,
    name,
    amount,
    quantity,
    cost_unit: cleanText(input.costUnit) || 'unit',
    recurrence_unit: input.recurrenceUnit,
    recurrence_interval: recurrenceInterval,
    start_date: input.startDate,
    end_date: endDate,
    due_day: dueDay,
    notes: cleanText(input.notes),
    is_active: input.isActive !== false,
  };

  const id = Number(input.id || 0);
  const result = id > 0
    ? await svc
        .from('fixed_cost_items')
        .update(payload)
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .select('id')
        .single()
    : await svc
        .from('fixed_cost_items')
        .insert({ ...payload, created_by: profile.id })
        .select('id')
        .single();

  if (result.error) throw result.error;
  return { success: true, id: result.data.id };
}

export async function deleteFixedCost(id: number) {
  const { workspaceId } = await requireManageFixedCosts();
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('fixed_cost_items')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return { success: true };
}
