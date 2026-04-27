import { NextRequest, NextResponse } from 'next/server';

import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServerSupabase } from '@/lib/supabase-server';
import { reconcileMarketplaceIntakeBatchScalevIdentity } from '@/lib/marketplace-intake-scalev-reconcile';

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-scalev-reconcile',
      8,
      10 * 60 * 1000,
      'Terlalu banyak reconcile Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardRoles(['owner'], 'Hanya owner yang bisa reconcile Scalev ID untuk Marketplace Intake.');
    } catch (error: any) {
      const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }

    const body = await req.json();
    const batchId = Number(body?.batchId || 0);
    if (!Number.isFinite(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'batchId tidak valid.' }, { status: 400 });
    }

    const authSupabase = createServerSupabase();
    const {
      data: { user },
    } = await authSupabase.auth.getUser();

    const result = await reconcileMarketplaceIntakeBatchScalevIdentity({
      batchId,
      reconciledByEmail: user?.email || null,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Marketplace intake Scalev reconcile error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal menarik Scalev ID untuk batch intake.' },
      { status: 500 },
    );
  }
}
