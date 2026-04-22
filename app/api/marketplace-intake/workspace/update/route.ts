import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  updateMarketplaceIntakeWorkspace,
  type MarketplaceIntakeWarehouseStatus,
} from '@/lib/marketplace-intake';

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mengubah workspace Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const body = await req.json();
    const orderIds = Array.isArray(body?.orderIds) ? body.orderIds : [];
    const shipmentDate = body?.shipmentDate ? String(body.shipmentDate) : null;
    const warehouseStatus = String(body?.warehouseStatus || '') as MarketplaceIntakeWarehouseStatus;
    const warehouseNote = body?.warehouseNote ? String(body.warehouseNote) : null;

    const authSupabase = createServerSupabase();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    const result = await updateMarketplaceIntakeWorkspace({
      orderIds,
      shipmentDate,
      warehouseStatus,
      warehouseNote,
      updatedByEmail: user?.email || null,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Marketplace intake workspace update error:', error);
    return NextResponse.json({ error: error.message || 'Marketplace intake workspace update failed' }, { status: 500 });
  }
}
