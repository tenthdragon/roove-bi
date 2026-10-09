import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGmsCampaignPeriodRows,
  buildGmsItemPeriodRows,
  buildGmsSnapshotRpcPayload,
} from '../lib/shopee-sync-runner';
import type { ShopeeGmsPeriodPerformance } from '../lib/shopee-open-platform';

const emptyReport = {
  impression: 0,
  clicks: 0,
  expense: 0,
  broad_gmv: 0,
  broad_order: 0,
  broad_order_amount: 0,
  broad_roi: 0,
  broad_cir: 0,
  cr: 0,
  cpc: 0,
  direct_order: 0,
  direct_order_amount: 0,
  direct_roi: 0,
  direct_cir: 0,
  direct_cr: 0,
  cpdc: 0,
};

const snapshot: ShopeeGmsPeriodPerformance = {
  campaign_id: 8811,
  period_start: '2026-09-01',
  period_end: '2026-09-10',
  report: {
    ...emptyReport,
    impression: 32_200,
    clicks: 449,
    expense: 1_587_617,
    broad_gmv: 8_460_000,
    broad_order: 22,
    broad_order_amount: 24,
    broad_roi: 5.33,
    broad_cir: 18.77,
    cr: 4.9,
    cpc: 72_164.4,
    direct_order: 17,
    direct_order_amount: 18,
    direct_roi: 3.84,
    direct_cir: 26.04,
    direct_cr: 3.79,
    cpdc: 93_389.24,
  },
  report_chunks: [],
  items: [{
    item_id: 101,
    report: {
      ...emptyReport,
      impression: 10_300,
      clicks: 133,
      expense: 603_711,
      broad_gmv: 3_975_000,
      broad_order: 7,
      broad_order_amount: 7,
      broad_roi: 6.58,
      broad_cir: 15.19,
      cr: 5.26,
      cpc: 86_244.44,
      direct_order: 5,
      direct_order_amount: 5,
      direct_roi: 4.72,
      direct_cir: 21.19,
      direct_cr: 3.76,
      cpdc: 120_742.2,
    },
    report_chunks: [],
  }],
};

test('maps Shop GMV Max campaign response to exact period grain', () => {
  const [row] = buildGmsCampaignPeriodRows({
    shop: { id: 7, shop_id: 227509446 },
    workspaceId: '00000000-0000-4000-8000-000000000001',
    snapshots: [snapshot],
    syncBatchId: '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(row.period_start, '2026-09-01');
  assert.equal(row.period_end, '2026-09-10');
  assert.deepEqual({
    workspace_id: row.workspace_id,
    shop_config_id: row.shop_config_id,
    shop_id: row.shop_id,
    campaign_id: row.campaign_id,
    impressions: row.impressions,
    clicks: row.clicks,
    expense: row.expense,
    broad_gmv: row.broad_gmv,
    broad_order: row.broad_order,
    broad_order_amount: row.broad_order_amount,
    broad_roas: row.broad_roas,
    broad_acos: row.broad_acos,
    conversion_rate: row.conversion_rate,
    cost_per_conversion: row.cost_per_conversion,
    direct_order: row.direct_order,
    direct_order_amount: row.direct_order_amount,
    direct_roas: row.direct_roas,
    direct_acos: row.direct_acos,
    direct_conversion_rate: row.direct_conversion_rate,
    cost_per_direct_conversion: row.cost_per_direct_conversion,
    sync_batch_id: row.sync_batch_id,
  }, {
    workspace_id: '00000000-0000-4000-8000-000000000001',
    shop_config_id: 7,
    shop_id: 227509446,
    campaign_id: 8811,
    impressions: 32_200,
    clicks: 449,
    expense: 1_587_617,
    broad_gmv: 8_460_000,
    broad_order: 22,
    broad_order_amount: 24,
    broad_roas: 5.33,
    broad_acos: 18.77,
    conversion_rate: 4.9,
    cost_per_conversion: 72_164.4,
    direct_order: 17,
    direct_order_amount: 18,
    direct_roas: 3.84,
    direct_acos: 26.04,
    direct_conversion_rate: 3.79,
    cost_per_direct_conversion: 93_389.24,
    sync_batch_id: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(row.raw_payload.source_api, 'v2.ads.get_gms_campaign_performance');
  assert.deepEqual(row.raw_payload.report, snapshot.report);
  assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal('metric_date' in row, false);
  assert.equal('direct_gmv' in row, false);
  assert.equal('campaign_status' in row, false);
  assert.equal('campaign_budget' in row, false);
  assert.equal('roas_target' in row, false);
});

test('maps Shop GMV Max item response without inventing product metadata', () => {
  const [row] = buildGmsItemPeriodRows({
    shop: { id: 7, shop_id: 227509446 },
    workspaceId: '00000000-0000-4000-8000-000000000001',
    snapshots: [snapshot],
    syncBatchId: '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(row.item_id, 101);
  assert.equal(row.campaign_id, 8811);
  assert.deepEqual({
    impressions: row.impressions,
    clicks: row.clicks,
    expense: row.expense,
    broad_gmv: row.broad_gmv,
    broad_order: row.broad_order,
    broad_order_amount: row.broad_order_amount,
    broad_roas: row.broad_roas,
    broad_acos: row.broad_acos,
    conversion_rate: row.conversion_rate,
    cost_per_conversion: row.cost_per_conversion,
    direct_order: row.direct_order,
    direct_order_amount: row.direct_order_amount,
    direct_roas: row.direct_roas,
    direct_acos: row.direct_acos,
    direct_conversion_rate: row.direct_conversion_rate,
    cost_per_direct_conversion: row.cost_per_direct_conversion,
  }, {
    impressions: 10_300,
    clicks: 133,
    expense: 603_711,
    broad_gmv: 3_975_000,
    broad_order: 7,
    broad_order_amount: 7,
    broad_roas: 6.58,
    broad_acos: 15.19,
    conversion_rate: 5.26,
    cost_per_conversion: 86_244.44,
    direct_order: 5,
    direct_order_amount: 5,
    direct_roas: 4.72,
    direct_acos: 21.19,
    direct_conversion_rate: 3.76,
    cost_per_direct_conversion: 120_742.2,
  });
  assert.equal(row.raw_payload.source_api, 'v2.ads.get_gms_item_performance');
  assert.deepEqual(row.raw_payload.report, snapshot.items[0].report);
  assert.equal('product_name' in row, false);
  assert.equal('metric_date' in row, false);
});

test('emits one item row per endpoint item and preserves parent period identity', () => {
  const rows = buildGmsItemPeriodRows({
    shop: { id: 7, shop_id: 227509446 },
    workspaceId: '00000000-0000-4000-8000-000000000001',
    snapshots: [{
      ...snapshot,
      items: [
        snapshot.items[0],
        { ...snapshot.items[0], item_id: 202 },
      ],
    }],
    syncBatchId: '11111111-1111-4111-8111-111111111111',
  });

  assert.deepEqual(rows.map((row) => ({
    campaign_id: row.campaign_id,
    item_id: row.item_id,
    period_start: row.period_start,
    period_end: row.period_end,
  })), [
    {
      campaign_id: 8811,
      item_id: 101,
      period_start: '2026-09-01',
      period_end: '2026-09-10',
    },
    {
      campaign_id: 8811,
      item_id: 202,
      period_start: '2026-09-01',
      period_end: '2026-09-10',
    },
  ]);
});

test('builds a compact GMS RPC payload and strips server-owned snapshot fields', () => {
  const campaignRows = buildGmsCampaignPeriodRows({
    shop: { id: 7, shop_id: 227509446 },
    workspaceId: '00000000-0000-4000-8000-000000000001',
    snapshots: [snapshot],
    syncBatchId: '11111111-1111-4111-8111-111111111111',
  });
  const itemRows = buildGmsItemPeriodRows({
    shop: { id: 7, shop_id: 227509446 },
    workspaceId: '00000000-0000-4000-8000-000000000001',
    snapshots: [snapshot],
    syncBatchId: '11111111-1111-4111-8111-111111111111',
  });

  const payload = buildGmsSnapshotRpcPayload(
    [{ ...campaignRows[0], ignored_field: 'must not cross the RPC boundary' }],
    [{ ...itemRows[0], product_name: 'must not cross the RPC boundary' }],
  );

  assert.deepEqual(Object.keys(payload.campaignRows[0]).sort(), [
    'broad_acos',
    'broad_gmv',
    'broad_order',
    'broad_order_amount',
    'broad_roas',
    'campaign_id',
    'clicks',
    'conversion_rate',
    'cost_per_conversion',
    'cost_per_direct_conversion',
    'direct_acos',
    'direct_conversion_rate',
    'direct_order',
    'direct_order_amount',
    'direct_roas',
    'expense',
    'impressions',
    'raw_payload',
  ].sort());
  assert.deepEqual(payload.campaignRows[0].raw_payload, {
    source_api: 'v2.ads.get_gms_campaign_performance',
    chunk_count: 0,
  });
  assert.deepEqual(payload.itemRows[0].raw_payload, {
    source_api: 'v2.ads.get_gms_item_performance',
    chunk_count: 0,
  });
  assert.equal(payload.itemRows[0].item_id, 101);
  assert.equal('workspace_id' in payload.campaignRows[0], false);
  assert.equal('shop_config_id' in payload.campaignRows[0], false);
  assert.equal('period_start' in payload.campaignRows[0], false);
  assert.equal('sync_batch_id' in payload.campaignRows[0], false);
  assert.equal('ignored_field' in payload.campaignRows[0], false);
  assert.equal('product_name' in payload.itemRows[0], false);
  assert.equal('report' in payload.itemRows[0].raw_payload, false);
});

test('rejects a GMS RPC payload above the safe request byte cap', () => {
  assert.throws(() => buildGmsSnapshotRpcPayload([{
    campaign_id: 8811,
    raw_payload: {
      source_api: 'x'.repeat(5_500_001),
      chunk_count: 1,
    },
  }], []), /terlalu besar untuk dipublikasikan dengan aman/);
});
