import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { buildScalevOpsProjectionForBatch } from '@/lib/marketplace-intake-scalev-export';

export async function GET(req: NextRequest) {
  try {
    try {
      await requireDashboardPermissionAccess('admin:daily', 'Admin Daily Data');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const batchId = Number(req.nextUrl.searchParams.get('batchId') || 0);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'batchId tidak valid.' }, { status: 400 });
    }

    const statuses = (req.nextUrl.searchParams.get('statuses') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const shipmentDate = (req.nextUrl.searchParams.get('shipmentDate') || '').trim() || null;

    const result = await buildScalevOpsProjectionForBatch({
      batchId,
      includeWarehouseStatuses: statuses,
      shipmentDate,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace intake Scalev preview error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal membentuk preview Scalev dari intake.' },
      { status: 500 },
    );
  }
}
