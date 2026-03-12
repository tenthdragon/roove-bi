import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://hpsenndhoyzgnnkrhtly.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc2VubmRob3l6Z25ua3JodGx5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4MjkwNiwiZXhwIjoyMDg2NDU4OTA2fQ._vU2DP7svUWfHNCArQlCaJeuKQasPpnUtQ-rO_8lv00'
);

const { data, error } = await sb.from('daily_ads_spend')
  .select('id, date, source, store, spent')
  .gte('date', '2026-02-01').lte('date', '2026-02-28')
  .eq('source', 'Conversion');

if (error) { console.error(error); process.exit(1); }
console.log('Rows to fix:', data.length);

// Based on Jan pattern: current store value is actually the source
const fixMap = {
  'TikTok Ads':            { source: 'TikTok Ads',            store: 'Roove' },
  'TikTok Shop':           { source: 'TikTok Shop',           store: 'Purvu Store' },
  'Shopee - Roove':        { source: 'Shopee - Roove',        store: 'Roove' },
  'Shopee - Roove - Live': { source: 'Shopee - Roove - Live', store: 'Roove' },
};

let fixed = 0, skipped = 0;
for (const row of data) {
  const fix = fixMap[row.store];
  if (!fix) { console.log('SKIP unknown store:', row.store); skipped++; continue; }
  const { error: upErr } = await sb.from('daily_ads_spend')
    .update({ source: fix.source, store: fix.store })
    .eq('id', row.id);
  if (upErr) { console.error('Update error:', row.id, upErr.message); }
  else { fixed++; }
}
console.log('Fixed:', fixed, 'Skipped:', skipped);

// Verify
const { data: verify } = await sb.from('daily_ads_spend')
  .select('source, store, spent')
  .gte('date', '2026-02-01').lte('date', '2026-02-28');

const bySource = {}, byStore = {};
verify.forEach(r => {
  bySource[r.source] = (bySource[r.source] || 0) + Math.abs(Number(r.spent || 0));
  byStore[r.store] = (byStore[r.store] || 0) + Math.abs(Number(r.spent || 0));
});
console.log('\n=== AFTER FIX ===');
console.log('By source:');
Object.entries(bySource).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(' ', k, '->', (v / 1e6).toFixed(1) + 'M'));
console.log('By store:');
Object.entries(byStore).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(' ', k, '->', (v / 1e6).toFixed(1) + 'M'));
