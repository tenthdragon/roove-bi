import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { createServerSupabase } from '@/lib/supabase-server';
import { sendMarketplaceIntakeBatchToScalev } from '@/lib/marketplace-intake-scalev-send';

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mengirim Marketplace Intake ke Scalev.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const body = await req.json();
    const batchId = Number(body?.batchId || 0);
    const shipmentDate = body?.shipmentDate ? String(body.shipmentDate) : null;
    const includeWarehouseStatuses = Array.isArray(body?.statuses)
      ? body.statuses.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : undefined;
    const createType = body?.createType === 'archive' ? 'archive' : 'regular';

    if (!Number.isFinite(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'batchId tidak valid.' }, { status: 400 });
    }

    const authSupabase = createServerSupabase();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    const result = await sendMarketplaceIntakeBatchToScalev({
      batchId,
      shipmentDate,
      includeWarehouseStatuses,
      createType,
      sentByEmail: user?.email || null,
      tz: 'Asia/Jakarta',
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Marketplace intake Scalev send error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal mengirim batch intake ke Scalev.' },
      { status: 500 },
    );
  }
}
