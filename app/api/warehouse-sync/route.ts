// app/api/warehouse-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { triggerWarehouseSync } from '@/lib/warehouse-actions';

export const maxDuration = 250;

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (authHeader && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await triggerWarehouseSync();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Warehouse Sync API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await triggerWarehouseSync();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Warehouse Sync API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
