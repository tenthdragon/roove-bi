import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

import { fetchOrderDetail } from '../../lib/scalev-api';
import { extractMarketplaceTrackingFromWebhookData } from '../../lib/marketplace-tracking';
import { parseScalevHeaderFinancialFields } from '../../lib/scalev-header-financials';

function parseEnvFile(path: string) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [line.slice(0, idx), value];
      }),
  );
}

function argValue(name: string) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] || null;
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function num(value: unknown) {
  if (value == null) return 0;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ts(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

let aliasResolutionRegistered = false;
function registerNextAliasResolution() {
  if (aliasResolutionRegistered) return;
  aliasResolutionRegistered = true;
  const mod = require('module');
  const path = require('path');
  const originalResolve = mod._resolveFilename;
  mod._resolveFilename = function resolveFilename(request: string, parent: unknown, isMain: boolean, options: unknown) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(process.cwd(), request.slice(2)), parent, isMain, options);
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };
}

async function reconcileWarehouse(orderId: string, dbOrderId: number) {
  registerNextAliasResolution();
  const mod = await import('../../lib/warehouse-ledger-actions');
  return mod.reconcileScalevOrderWarehouse(orderId, dbOrderId);
}

async function main() {
  const businessCode = cleanText(argValue('business'));
  const orderId = cleanText(argValue('order-id'));
  const apply = process.argv.includes('--apply');
  const skipWarehouse = process.argv.includes('--skip-warehouse');

  if (!businessCode || !orderId) {
    throw new Error('Use --business=CODE --order-id=ORDER_ID.');
  }

  const env = parseEnvFile('.env.local');
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: business, error: businessError } = await supabase
    .from('scalev_webhook_businesses')
    .select('business_code, api_key')
    .eq('business_code', businessCode)
    .single();
  if (businessError) throw businessError;

  const { data: existing, error: existingError } = await supabase
    .from('scalev_orders')
    .select('id, order_id, scalev_id, status, raw_data')
    .eq('business_code', businessCode)
    .eq('order_id', orderId)
    .single();
  if (existingError) throw existingError;

  const detailId = cleanText(existing.scalev_id || existing.raw_data?.id || orderId);
  const detail = await fetchOrderDetail(business.api_key, 'https://api.scalev.id/v2', detailId);
  const parsedHeaderFinancials = parseScalevHeaderFinancialFields(detail);
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(detail);

  const updateData = {
    scalev_id: cleanText(detail?.id) || null,
    status: cleanText(detail?.status) || 'unknown',
    gross_revenue: num(detail?.gross_revenue),
    net_revenue: num(detail?.net_revenue),
    shipping_cost: num(detail?.shipping_cost),
    shipping_discount: parsedHeaderFinancials.shippingDiscountPresent ? parsedHeaderFinancials.shippingDiscount : null,
    discount_code_discount: parsedHeaderFinancials.discountCodeDiscountPresent ? parsedHeaderFinancials.discountCodeDiscount : null,
    unique_code_discount: num(detail?.unique_code_discount),
    total_quantity: num(detail?.total_quantity),
    marketplace_tracking_number: trackingNumber,
    draft_time: ts(detail?.draft_time),
    pending_time: ts(detail?.pending_time),
    confirmed_time: ts(detail?.confirmed_time),
    paid_time: ts(detail?.paid_time),
    shipped_time: ts(detail?.shipped_time),
    completed_time: ts(detail?.completed_time),
    canceled_time: ts(detail?.canceled_time),
    raw_data: detail,
    synced_at: new Date().toISOString(),
  };

  const summary: Record<string, unknown> = {
    apply,
    business_code: businessCode,
    order_id: orderId,
    scalev_id: updateData.scalev_id,
    old_status: existing.status,
    new_status: updateData.status,
    gross_revenue: updateData.gross_revenue,
    net_revenue: updateData.net_revenue,
    warehouse: null,
    warehouse_error: null,
  };

  if (apply) {
    const { error: updateError } = await supabase
      .from('scalev_orders')
      .update(updateData)
      .eq('id', existing.id);
    if (updateError) throw updateError;

    if (!skipWarehouse) {
      try {
        summary.warehouse = await reconcileWarehouse(orderId, Number(existing.id));
      } catch (error) {
        summary.warehouse_error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  if (error?.cause) console.error('cause:', error.cause);
  process.exit(1);
});
