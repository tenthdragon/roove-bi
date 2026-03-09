// Script to fix is_purchase_fb and sales_channel based on raw_data.message_variables.advertiser
// Run with: node scripts/fix-channel-advertiser.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hpsenndhoyzgnnkrhtly.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  // Try reading from .env.local
  const fs = await import('fs');
  const envContent = fs.readFileSync('.env.local', 'utf-8');
  const match = envContent.match(/SUPABASE_SERVICE_ROLE_KEY="([^"]+)"/);
  if (match) {
    var serviceKey = match[1];
  } else {
    console.error('SUPABASE_SERVICE_ROLE_KEY not found');
    process.exit(1);
  }
} else {
  var serviceKey = SUPABASE_SERVICE_KEY;
}

const svc = createClient(SUPABASE_URL, serviceKey);

async function fetchAllPages(query, pageSize = 1000) {
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Step 1: Find all webhook scalev orders
console.log('Fetching all webhook scalev orders...');
const orders = await fetchAllPages(
  svc.from('scalev_orders')
    .select('id, order_id, is_purchase_fb, is_purchase_tiktok, raw_data, source')
    .eq('source', 'webhook')
    .eq('platform', 'scalev')
);

console.log(`Found ${orders.length} webhook scalev orders`);

let toFbAds = 0;
let toOrganik = 0;
let unchanged = 0;

for (const order of orders) {
  const advertiser = (order.raw_data?.message_variables?.advertiser || '').trim();
  const shouldBeFb = advertiser !== '';
  const currentFb = order.is_purchase_fb === true;

  if (shouldBeFb && !currentFb) {
    // Has advertiser but not marked as FB → fix
    const { error } = await svc.from('scalev_orders')
      .update({ is_purchase_fb: true })
      .eq('id', order.id);
    if (error) console.error(`Error updating order ${order.order_id}:`, error.message);

    // Fix lines
    const { error: lineErr, count } = await svc.from('scalev_order_lines')
      .update({ sales_channel: 'Facebook Ads', is_purchase_fb: true })
      .eq('scalev_order_id', order.id)
      .neq('sales_channel', 'Facebook Ads');
    if (lineErr) console.error(`Error updating lines for ${order.order_id}:`, lineErr.message);
    toFbAds++;
  } else if (!shouldBeFb && currentFb && order.is_purchase_tiktok !== true) {
    // No advertiser but marked as FB (and not from CSV override) → check if raw_data has explicit flag
    const rawFb = order.raw_data?.is_purchase_fb;
    if (rawFb === undefined || rawFb === null) {
      // Not from CSV, was incorrectly classified → fix to Organik
      const { error } = await svc.from('scalev_orders')
        .update({ is_purchase_fb: false })
        .eq('id', order.id);
      if (error) console.error(`Error updating order ${order.order_id}:`, error.message);

      const { error: lineErr } = await svc.from('scalev_order_lines')
        .update({ sales_channel: 'Organik', is_purchase_fb: false })
        .eq('scalev_order_id', order.id)
        .eq('sales_channel', 'Facebook Ads');
      if (lineErr) console.error(`Error updating lines for ${order.order_id}:`, lineErr.message);
      toOrganik++;
    } else {
      unchanged++;
    }
  } else {
    unchanged++;
  }
}

console.log(`\nResults:`);
console.log(`  → Facebook Ads (had advertiser): ${toFbAds}`);
console.log(`  → Organik (no advertiser): ${toOrganik}`);
console.log(`  Unchanged: ${unchanged}`);

// Refresh materialized views
console.log('\nRefreshing materialized views...');
const { error: refreshErr } = await svc.rpc('refresh_order_views', { force_refresh: true });
if (refreshErr) {
  console.error('Error refreshing views:', refreshErr.message);
} else {
  console.log('Materialized views refreshed successfully.');
}

console.log('\nDone!');
