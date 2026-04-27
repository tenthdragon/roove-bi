import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServerSupabase } from '@/lib/supabase-server';
import { promoteMarketplaceIntakeBatchToApp } from '@/lib/marketplace-intake-app-promote';

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-promote-app',
      6,
      10 * 60 * 1000,
      'Terlalu banyak promosi Marketplace Intake ke app. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mempromosikan Marketplace Intake ke app.');
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

    if (!Number.isFinite(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'batchId tidak valid.' }, { status: 400 });
    }

    const authSupabase = createServerSupabase();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    const result = await promoteMarketplaceIntakeBatchToApp({
      batchId,
      shipmentDate,
      includeWarehouseStatuses,
      promotedByEmail: user?.email || null,
    });

    revalidateTag('shipping-fee-range');

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Marketplace intake app promote error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal mempromosikan batch intake ke app.' },
      { status: 500 },
    );
  }
}
