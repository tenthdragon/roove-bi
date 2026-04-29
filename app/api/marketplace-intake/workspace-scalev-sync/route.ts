import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { requireDashboardRoles } from '@/lib/dashboard-access';
import {
  inspectMarketplaceIntakeWorkspaceScalevSync,
  repairMarketplaceIntakeWorkspaceScalevSync,
} from '@/lib/marketplace-intake-workspace-scalev-sync';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServerSupabase } from '@/lib/supabase-server';

function getCurrentDateValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const maxDuration = 250;

async function requireOwnerAccess(req: NextRequest) {
  const originError = rejectUntrustedOrigin(req);
  if (originError) return { response: originError, userEmail: null };

  const sessionError = rejectMissingDashboardSession(req);
  if (sessionError) return { response: sessionError, userEmail: null };

  try {
    await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat sinkronisasi Marketplace Intake.');
  } catch (error: any) {
    const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
    return {
      response: NextResponse.json({ error: error.message }, { status }),
      userEmail: null,
    };
  }

  const authSupabase = createServerSupabase();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  return {
    response: null,
    userEmail: user?.email || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const access = await requireOwnerAccess(req);
    if (access.response) return access.response;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-workspace-scalev-sync-read',
      20,
      10 * 60 * 1000,
      'Terlalu banyak cek sinkronisasi Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const shipmentDate = String(req.nextUrl.searchParams.get('shipmentDate') || getCurrentDateValue());
    const sourceKey = String(req.nextUrl.searchParams.get('sourceKey') || '').trim() || null;
    const result = await inspectMarketplaceIntakeWorkspaceScalevSync({
      shipmentDate,
      sourceKey,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace intake workspace Scalev sync read error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal membaca akurasi Scalev vs app.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const access = await requireOwnerAccess(req);
    if (access.response) return access.response;

    const rateLimitError = limitByIp(
      req,
      'marketplace-intake-workspace-scalev-sync-repair',
      4,
      10 * 60 * 1000,
      'Terlalu banyak perbaikan sinkronisasi Marketplace Intake. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const body = await req.json();
    const shipmentDate = body?.shipmentDate ? String(body.shipmentDate) : getCurrentDateValue();
    const sourceKey = String(body?.sourceKey || '').trim() || null;

    const result = await repairMarketplaceIntakeWorkspaceScalevSync({
      shipmentDate,
      sourceKey,
      repairedByEmail: access.userEmail,
    });

    revalidateTag('shipping-fee-range');

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Marketplace intake workspace Scalev sync repair error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal memperbaiki gap Scalev vs app.' },
      { status: 500 },
    );
  }
}
