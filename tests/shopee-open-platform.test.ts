import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeShopeeProductCampaignPerformance,
  normalizeShopeeProductCampaignSetting,
} from '../lib/shopee-open-platform';

test('normalizes Shopee product campaign target, products, and manual keywords', () => {
  const setting = normalizeShopeeProductCampaignSetting({
    campaign_id: '7788',
    common_info: {
      ad_type: 'auto',
      ad_name: 'Grup Iklan Collagen',
      campaign_status: 'ongoing',
      bidding_method: 'auto',
      campaign_placement: 'all',
      campaign_budget: '15999999',
      campaign_duration: { start_time: 1725235200, end_time: 0 },
      item_id_list: ['101', 102],
    },
    manual_bidding_info: {
      enhanced_cpc: true,
      selected_keywords: [
        {
          keyword: 'kolagen kulit',
          status: 'normal',
          match_type: 'broad',
          bid_price_per_click: '1250',
        },
      ],
    },
    auto_bidding_info: { roas_target: '4.3' },
    auto_product_ads_info: [
      { item_id: '101', product_name: 'Globite Collagen', status: 'ongoing' },
      { item_id: 102, product_name: 'Roove Collagen Drink', status: 'learning' },
    ],
  });

  assert.equal(setting.campaign_id, 7788);
  assert.equal(setting.common_info.campaign_budget, 15_999_999);
  assert.deepEqual(setting.common_info.item_id_list, [101, 102]);
  assert.equal(setting.auto_bidding_info?.roas_target, 4.3);
  assert.equal(setting.auto_product_ads_info?.[0].product_name, 'Globite Collagen');
  assert.deepEqual(setting.manual_bidding_info?.selected_keywords?.[0], {
    keyword: 'kolagen kulit',
    status: 'normal',
    match_type: 'broad',
    bid_price_per_click: 1250,
  });
});

test('flattens product campaign daily metrics and keeps broad and direct attribution separate', () => {
  const points = normalizeShopeeProductCampaignPerformance([
    {
      shop_id: 123,
      campaign_list: [
        {
          campaign_id: '7788',
          ad_type: 'auto',
          campaign_placement: 'all',
          ad_name: 'Grup Iklan Collagen',
          metrics_list: [
            {
              date: '03-09-2026',
              impression: '10000',
              clicks: '200',
              ctr: '2',
              expense: '1000000',
              broad_gmv: '7260000',
              broad_order: '21',
              broad_order_amount: '24',
              broad_roi: '7.26',
              broad_cir: '13.77',
              cr: '10.5',
              cpc: '47619',
              direct_gmv: '4340000',
              direct_order: '13',
              direct_order_amount: '14',
              direct_roi: '4.34',
              direct_cir: '23.04',
              direct_cr: '6.5',
              cpdc: '76923',
            },
          ],
        },
      ],
    },
  ]);

  assert.equal(points.length, 1);
  assert.deepEqual(points[0], {
    campaign_id: 7788,
    ad_type: 'auto',
    campaign_placement: 'all',
    ad_name: 'Grup Iklan Collagen',
    date: '2026-09-03',
    impression: 10000,
    clicks: 200,
    ctr: 2,
    expense: 1000000,
    broad_gmv: 7260000,
    broad_order: 21,
    broad_order_amount: 24,
    broad_roi: 7.26,
    broad_cir: 13.77,
    cr: 10.5,
    cpc: 47619,
    direct_gmv: 4340000,
    direct_order: 13,
    direct_order_amount: 14,
    direct_roi: 4.34,
    direct_cir: 23.04,
    direct_cr: 6.5,
    cpdc: 76923,
  });
});

test('drops malformed campaign rows without a valid id or date', () => {
  assert.deepEqual(
    normalizeShopeeProductCampaignPerformance({
      campaign_list: [
        { campaign_id: 0, metrics_list: [{ date: '01-09-2026' }] },
        { campaign_id: 1, metrics_list: [{ date: '' }] },
      ],
    }),
    [],
  );
});
