// app/api/warehouse-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { triggerWarehouseSync } from '@/lib/warehouse-actions';

export const maxDuration = 250;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      try {
        await requireDashboardPermissionAccess('admin:warehouse', 'Admin Warehouse');
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        return NextResponse.json({ error: err.message }, { status });
      }
    }

    const result = await triggerWarehouseSync({ skipAuth: true });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Warehouse Sync API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && (secret === cronSecret || authHeader === `Bearer ${cronSecret}`);

  if (!isCron) {
    try {
      await requireDashboardPermissionAccess('admin:warehouse', 'Admin Warehouse');
    } catch (err: any) {
      const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
      return NextResponse.json({ error: err.message }, { status });
    }
  }

  try {
    const result = await triggerWarehouseSync({ skipAuth: true });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Warehouse Sync API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
