import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { getMarketplaceIntakeHistoryBatchDetail } from '@/lib/marketplace-intake';

export const maxDuration = 250;

export async function GET(
  _req: NextRequest,
  context: { params: { batchId: string } },
) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat detail Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const batchId = Number(context.params.batchId || 0);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'Batch id tidak valid.' }, { status: 400 });
    }

    const detail = await getMarketplaceIntakeHistoryBatchDetail(batchId);
    return NextResponse.json(detail);
  } catch (error: any) {
    const status = /tidak ditemukan/i.test(error.message || '') ? 404 : 500;
    console.error('Marketplace intake history detail error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake history detail failed' }, { status });
  }
}
