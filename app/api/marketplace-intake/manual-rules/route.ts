import { NextRequest, NextResponse } from 'next/server';

import { requireDashboardRoles } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  listMarketplaceManualRules,
  upsertMarketplaceManualRule,
} from '@/lib/marketplace-intake-manual-rules';

export const maxDuration = 120;

async function guardOwner(message: string) {
  try {
    await requireDashboardRoles(['owner'], message);
    return null;
  } catch (error: any) {
    const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }
}

export async function GET(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-manual-rules-read',
      30,
      10 * 60 * 1000,
      'Terlalu banyak permintaan resolver rule marketplace. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const denied = await guardOwner('Hanya owner yang bisa melihat resolver rule marketplace.');
    if (denied) return denied;

    const limit = Number(req.nextUrl.searchParams.get('limit') || 500);
    const sourceKey = req.nextUrl.searchParams.get('sourceKey');
    const result = await listMarketplaceManualRules({ limit, sourceKey });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace manual rules GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal memuat resolver rule marketplace.' },
      { status: 500 },
    );
  }
}

async function getUserEmail() {
  const authSupabase = createServerSupabase();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  return user?.email || null;
}

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-manual-rules-write',
      20,
      10 * 60 * 1000,
      'Terlalu banyak perubahan resolver rule marketplace. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const denied = await guardOwner('Hanya owner yang bisa mengubah resolver rule marketplace.');
    if (denied) return denied;

    const body = await req.json();
    const item = await upsertMarketplaceManualRule({
      sourceKey: body?.sourceKey,
      mpSku: body?.mpSku,
      mpProductName: body?.mpProductName,
      mpVariation: body?.mpVariation,
      targetEntityKey: body?.targetEntityKey,
      targetEntityLabel: body?.targetEntityLabel,
      targetCustomId: body?.targetCustomId,
      scalevBundleId: body?.scalevBundleId,
      mappedStoreName: body?.mappedStoreName,
      isActive: body?.isActive,
      updatedByEmail: await getUserEmail(),
    });
    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    console.error('Marketplace manual rules POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal menyimpan resolver rule marketplace.' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'marketplace-manual-rules-write',
      20,
      10 * 60 * 1000,
      'Terlalu banyak perubahan resolver rule marketplace. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const denied = await guardOwner('Hanya owner yang bisa mengubah resolver rule marketplace.');
    if (denied) return denied;

    const body = await req.json();
    const id = Number(body?.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'ID rule tidak valid.' }, { status: 400 });
    }

    const item = await upsertMarketplaceManualRule({
      id,
      sourceKey: body?.sourceKey,
      mpSku: body?.mpSku,
      mpProductName: body?.mpProductName,
      mpVariation: body?.mpVariation,
      targetEntityKey: body?.targetEntityKey,
      targetEntityLabel: body?.targetEntityLabel,
      targetCustomId: body?.targetCustomId,
      scalevBundleId: body?.scalevBundleId,
      mappedStoreName: body?.mappedStoreName,
      isActive: body?.isActive,
      updatedByEmail: await getUserEmail(),
    });
    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    console.error('Marketplace manual rules PATCH error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal mengubah resolver rule marketplace.' },
      { status: 500 },
    );
  }
}
