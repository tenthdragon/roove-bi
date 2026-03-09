// Script to fix is_purchase_fb and sales_channel based on raw_data.message_variables.advertiser
// Only updates webhook orders where is_purchase_fb=false but advertiser is non-empty.
// NEVER overrides CSV-set values (CSV is source of truth).
// Run with: node scripts/fix-channel-advertiser.mjs

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = 'https://hpsenndhoyzgnnkrhtly.supabase.co';
const envContent = fs.readFileSync('.env.local', 'utf-8');
const match = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
if (!match) { console.error('SUPABASE_SERVICE_ROLE_KEY not found'); process.exit(1); }
const svc = createClient(SUPABASE_URL, match[1]);

// Paginate with deterministic ordering
async function fetchAllPages(table, select, filters, pageSize = 1000) {
  const all = [];
  let from = 0;
  while (true) {
    let q = svc.from(table).select(select).order('id');
    for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Fetch all webhook scalev orders
console.log('Fetching all webhook scalev orders...');
const orders = await fetchAllPages('scalev_orders',
  'id, order_id, is_purchase_fb, is_purchase_tiktok, raw_data',
  { source: 'webhook', platform: 'scalev' }
);
console.log(`Found ${orders.length} webhook scalev orders`);

let toFbAds = 0;
let alreadyCorrect = 0;
let noAdvertiser = 0;
let errors = 0;

for (const order of orders) {
  const advertiser = (order.raw_data?.message_variables?.advertiser || '').trim();
  const currentFb = order.is_purchase_fb === true;

  if (!advertiser) {
    // No advertiser → CS Manual. Don't change anything (might be correctly set by CSV).
    noAdvertiser++;
    continue;
  }

  if (currentFb) {
    // Already correct
    alreadyCorrect++;
    continue;
  }

  // Has advertiser but is_purchase_fb=false → fix to true
  const { error: upErr } = await svc.from('scalev_orders')
    .update({ is_purchase_fb: true })
    .eq('id', order.id);

  if (upErr) {
    console.error(`Error updating order ${order.order_id}:`, upErr.message);
    errors++;
    continue;
  }

  // Fix order lines: only update scalev-channel lines (don't touch Reseller, marketplace channels)
  const { error: lineErr } = await svc.from('scalev_order_lines')
    .update({ sales_channel: 'Facebook Ads', is_purchase_fb: true })
    .eq('scalev_order_id', order.id)
    .in('sales_channel', ['Organik', 'TikTok Ads']);

  if (lineErr) {
    console.error(`Error updating lines for ${order.order_id}:`, lineErr.message);
    errors++;
  }

  toFbAds++;
}

console.log(`\nResults:`);
console.log(`  Updated to Facebook Ads: ${toFbAds}`);
console.log(`  Already correct (fb=true): ${alreadyCorrect}`);
console.log(`  No advertiser (CS Manual): ${noAdvertiser}`);
console.log(`  Errors: ${errors}`);

// Refresh materialized views
console.log('\nRefreshing materialized views...');
const { error: refreshErr } = await svc.rpc('refresh_order_views');
if (refreshErr) {
  console.error('Error refreshing views:', refreshErr.message);
} else {
  console.log('Materialized views refreshed.');
}

console.log('Done!');
