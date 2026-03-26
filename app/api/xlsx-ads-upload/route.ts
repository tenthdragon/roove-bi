// app/api/xlsx-ads-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 120;

const ALLOWED_STORES = new Set([
  'Roove', 'Purvu', 'Purvu Store', 'Osgard', 'Pluve', 'Calmara', 'DrHyun', 'YUV',
]);

const STORE_NORMALIZE: Record<string, string> = {
  'Clola': 'YUV',
  'Plume': 'Pluve',
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      return NextResponse.json({ error: 'Only .xlsx/.xls files accepted' }, { status: 400 });
    }

    // Parse xlsx
    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    // Find "Ads" sheet
    const adsSheet = wb.Sheets['Ads'] || wb.Sheets['ads'] || wb.Sheets['ADS'];
    if (!adsSheet) {
      const sheetNames = wb.SheetNames.join(', ');
      return NextResponse.json({ error: `Sheet "Ads" not found. Available: ${sheetNames}` }, { status: 400 });
    }

    // Convert to JSON (raw rows)
    const rawRows: any[][] = XLSX.utils.sheet_to_json(adsSheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

    // Find header row (contains "Date" and "Spent")
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const row = rawRows[i].map((v: any) => String(v || '').trim());
      if (row.includes('Date') && row.includes('Spent')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) {
      return NextResponse.json({ error: 'Could not find header row with "Date" and "Spent" columns' }, { status: 400 });
    }

    const headers = rawRows[headerIdx].map((v: any) => String(v || '').trim());
    const colIdx = {
      date: headers.indexOf('Date'),
      ad_account: headers.indexOf('Ad Account'),
      spent: headers.indexOf('Spent'),
      objective: headers.indexOf('Objective'),
      source: headers.indexOf('Source'),
      store: headers.indexOf('Store'),
      advertiser: headers.indexOf('Advertiser'),
    };

    if (colIdx.date === -1 || colIdx.spent === -1) {
      return NextResponse.json({ error: 'Missing required columns: Date, Spent' }, { status: 400 });
    }

    // Parse data rows
    const rows: any[] = [];
    let skipped = 0;
    const skippedStores = new Set<string>();

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const raw = rawRows[i];
      if (!raw || !raw[colIdx.date]) continue;

      // Parse date
      let dateStr = String(raw[colIdx.date]).trim();
      // Handle various date formats
      if (dateStr.includes('T')) dateStr = dateStr.split('T')[0]; // ISO datetime
      const dateMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!dateMatch) continue;
      const date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;

      // Parse spent
      const spent = parseFloat(String(raw[colIdx.spent] || '0').replace(/,/g, ''));
      if (isNaN(spent) || spent <= 0) continue;

      // Normalize store
      let store = colIdx.store >= 0 ? String(raw[colIdx.store] || '').trim() : '';
      if (STORE_NORMALIZE[store]) store = STORE_NORMALIZE[store];

      if (!ALLOWED_STORES.has(store)) {
        skipped++;
        if (store) skippedStores.add(store);
        continue;
      }

      rows.push({
        date,
        ad_account: colIdx.ad_account >= 0 ? String(raw[colIdx.ad_account] || '').trim() : null,
        spent,
        objective: colIdx.objective >= 0 ? String(raw[colIdx.objective] || '').trim() : null,
        source: colIdx.source >= 0 ? String(raw[colIdx.source] || '').trim() : null,
        store,
        advertiser: colIdx.advertiser >= 0 ? String(raw[colIdx.advertiser] || '').trim() : null,
        data_source: 'xlsx_upload',
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({
        error: 'No valid rows found',
        skipped,
        skippedStores: [...skippedStores],
      }, { status: 400 });
    }

    // Determine date range
    const dates = rows.map(r => r.date).sort();
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];

    const svc = getServiceSupabase();

    // Delete existing xlsx_upload data for this date range
    const { error: delErr } = await svc
      .from('daily_ads_spend')
      .delete()
      .eq('data_source', 'xlsx_upload')
      .gte('date', dateFrom)
      .lte('date', dateTo);

    if (delErr) {
      return NextResponse.json({ error: `Delete failed: ${delErr.message}` }, { status: 500 });
    }

    // Batch insert
    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insErr } = await svc.from('daily_ads_spend').insert(batch);
      if (insErr) {
        return NextResponse.json({
          error: `Insert failed at batch ${Math.floor(i / batchSize)}: ${insErr.message}`,
          inserted,
        }, { status: 500 });
      }
      inserted += batch.length;
    }

    // Log to data_imports
    await svc.from('data_imports').insert({
      filename: file.name,
      period_month: parseInt(dateFrom.split('-')[1]),
      period_year: parseInt(dateFrom.split('-')[0]),
      row_count: inserted,
      status: 'completed',
      notes: `XLSX ads upload: ${inserted} rows (${skipped} skipped). Date range: ${dateFrom} to ${dateTo}`,
    });

    return NextResponse.json({
      success: true,
      inserted,
      skipped,
      skippedStores: [...skippedStores],
      dateRange: { from: dateFrom, to: dateTo },
      filename: file.name,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
