import { NextRequest, NextResponse } from 'next/server';

import { requireDashboardRoles } from '@/lib/dashboard-access';
import {
  listMarketplaceSkuAliases,
  upsertMarketplaceSkuAlias,
} from '@/lib/marketplace-intake-sku-aliases';

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
    const denied = await guardOwner('Hanya owner yang bisa melihat SKU alias marketplace.');
    if (denied) return denied;

    const limit = Number(req.nextUrl.searchParams.get('limit') || 500);
    const sourceKey = req.nextUrl.searchParams.get('sourceKey');
    const result = await listMarketplaceSkuAliases({ limit, sourceKey });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Marketplace SKU aliases GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal memuat SKU alias marketplace.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await guardOwner('Hanya owner yang bisa mengubah SKU alias marketplace.');
    if (denied) return denied;

    const body = await req.json();
    const item = await upsertMarketplaceSkuAlias({
      sourceKey: body?.sourceKey,
      rawPlatformSkuId: body?.rawPlatformSkuId,
      rawSellerSku: body?.rawSellerSku,
      rawProductName: body?.rawProductName,
      rawVariation: body?.rawVariation,
      normalizedSku: body?.normalizedSku,
      reason: body?.reason,
      isActive: body?.isActive,
    });
    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    console.error('Marketplace SKU aliases POST error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal menyimpan SKU alias marketplace.' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const denied = await guardOwner('Hanya owner yang bisa mengubah SKU alias marketplace.');
    if (denied) return denied;

    const body = await req.json();
    const id = Number(body?.id || 0);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'ID alias tidak valid.' }, { status: 400 });
    }

    const item = await upsertMarketplaceSkuAlias({
      id,
      sourceKey: body?.sourceKey,
      rawPlatformSkuId: body?.rawPlatformSkuId,
      rawSellerSku: body?.rawSellerSku,
      rawProductName: body?.rawProductName,
      rawVariation: body?.rawVariation,
      normalizedSku: body?.normalizedSku,
      reason: body?.reason,
      isActive: body?.isActive,
    });
    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    console.error('Marketplace SKU aliases PATCH error:', error);
    return NextResponse.json(
      { error: error.message || 'Gagal mengubah SKU alias marketplace.' },
      { status: 500 },
    );
  }
}
