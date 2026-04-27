import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  updateMarketplaceIntakeWorkspace,
  type MarketplaceIntakeWarehouseStatus,
} from '@/lib/marketplace-intake';

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-workspace-update',
      20,
      10 * 60 * 1000,
      'Terlalu banyak perubahan workspace Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mengubah workspace Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const body = await req.json();
    const orderIds = Array.isArray(body?.orderIds) ? body.orderIds : [];
    const shipmentDate = body?.shipmentDate ? String(body.shipmentDate) : null;
    const sourceKey = body?.sourceKey ? String(body.sourceKey) : null;
    const warehouseStatus = String(body?.warehouseStatus || '') as MarketplaceIntakeWarehouseStatus;
    const warehouseNote = body?.warehouseNote ? String(body.warehouseNote) : null;

    const authSupabase = createServerSupabase();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    const result = await updateMarketplaceIntakeWorkspace({
      orderIds,
      shipmentDate,
      sourceKey,
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
