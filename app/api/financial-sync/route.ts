// app/api/financial-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { triggerFinancialSync } from '@/lib/financial-actions';

export const maxDuration = 120; // Allow up to 2 minutes for parsing

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret or authenticated user
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // Allow if CRON_SECRET matches OR if called from the app (no auth needed for server actions)
    if (authHeader && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await triggerFinancialSync();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Financial Sync API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET endpoint for cron jobs
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await triggerFinancialSync();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Financial Sync API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
