import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess, requireDashboardTabAccess } from '@/lib/dashboard-access';
import { backfillWarehouseDeductions } from '@/lib/warehouse-ledger-actions';

export const maxDuration = 300;

function parseRepairDate(input: unknown) {
  const value = typeof input === 'string' ? input.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export async function POST(request: NextRequest) {
  try {
    await requireDashboardTabAccess('warehouse', 'Sync Deduction Gudang');
    await requireDashboardPermissionAccess('wh:mapping_sync', 'Sync Deduction Gudang');
  } catch (err: any) {
    const status = /sesi|login/i.test(err?.message || '') ? 401 : 403;
    return NextResponse.json({ error: err?.message || 'Akses ditolak.' }, { status });
  }

  try {
    const body = await request.json().catch(() => null);
    const date = parseRepairDate(body?.date);
    if (!date) {
      return NextResponse.json({ error: 'Tanggal repair tidak valid.' }, { status: 400 });
    }

    const result = await backfillWarehouseDeductions(date);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Warehouse Deduction Repair API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Gagal menjalankan repair deduction.' },
      { status: 500 },
    );
  }
}
