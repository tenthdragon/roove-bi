import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateShopeeGmsReports,
  buildShopeeGmsDateChunks,
  fetchShopeeGmsPerformanceRange,
  getShopeeGmsItemPerformance,
  getShopeeApiErrorCode,
  getShopeeSetupInfo,
  isShopeeGmsUnavailableError,
  normalizeShopeeGmsCampaignPerformance,
  normalizeShopeeGmsItemPerformance,
  normalizeShopeeGmsReport,
  normalizeShopeeProductCampaignPerformance,
  normalizeShopeeProductCampaignSetting,
  ShopeeApiError,
} from '../lib/shopee-open-platform';

type FetchCall = {
  url: string;
  init?: RequestInit;
};

const completeGmsReport = (overrides: Record<string, string | number> = {}) => ({
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
  ...overrides,
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withMockShopeeFetch<T>(
  responses: unknown[],
  run: (calls: FetchCall[]) => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  const originalPartnerId = process.env.SHOPEE_PARTNER_ID;
  const originalPartnerKey = process.env.SHOPEE_PARTNER_KEY;
  const originalApiBaseUrl = process.env.SHOPEE_API_BASE_URL;
  const calls: FetchCall[] = [];
  let responseIndex = 0;

  process.env.SHOPEE_PARTNER_ID = '1232910';
  process.env.SHOPEE_PARTNER_KEY = 'test-partner-key';
  process.env.SHOPEE_API_BASE_URL = 'https://openplatform.sandbox.test-stable.shopee.sg';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (responseIndex >= responses.length) {
      throw new Error(`Unexpected Shopee request #${responseIndex + 1}`);
    }
    return jsonResponse(responses[responseIndex++]);
  }) as typeof fetch;

  try {
    const result = await run(calls);
    assert.equal(responseIndex, responses.length, 'all mocked Shopee responses should be consumed');
    return result;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPartnerId == null) delete process.env.SHOPEE_PARTNER_ID;
    else process.env.SHOPEE_PARTNER_ID = originalPartnerId;
    if (originalPartnerKey == null) delete process.env.SHOPEE_PARTNER_KEY;
    else process.env.SHOPEE_PARTNER_KEY = originalPartnerKey;
    if (originalApiBaseUrl == null) delete process.env.SHOPEE_API_BASE_URL;
    else process.env.SHOPEE_API_BASE_URL = originalApiBaseUrl;
  }
}

test('treats null-like Shopee credentials as missing configuration', () => {
  const originalPartnerId = process.env.SHOPEE_PARTNER_ID;
  const originalPartnerKey = process.env.SHOPEE_PARTNER_KEY;

  process.env.SHOPEE_PARTNER_ID = 'null';
  process.env.SHOPEE_PARTNER_KEY = '"undefined"';

  try {
    assert.deepEqual(getShopeeSetupInfo(), {
      configured: false,
      missingEnv: ['SHOPEE_PARTNER_ID', 'SHOPEE_PARTNER_KEY'],
    });
  } finally {
    if (originalPartnerId == null) delete process.env.SHOPEE_PARTNER_ID;
    else process.env.SHOPEE_PARTNER_ID = originalPartnerId;
    if (originalPartnerKey == null) delete process.env.SHOPEE_PARTNER_KEY;
    else process.env.SHOPEE_PARTNER_KEY = originalPartnerKey;
  }
});

test('normalizes Shopee product campaign target, products, and manual keywords', () => {
  const setting = normalizeShopeeProductCampaignSetting({
    campaign_id: '7788',
    common_info: {
      ad_type: 'auto',
      ad_name: 'Campaign Collagen',
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
          ad_name: 'Campaign Collagen',
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
    ad_name: 'Campaign Collagen',
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

test('normalizes the exact Shop GMV Max campaign report contract', () => {
  const campaign = normalizeShopeeGmsCampaignPerformance({
    campaign_id: '8811',
    report: {
      impression: '32200',
      clicks: '449',
      expense: '1587617',
      broad_gmv: '8460000',
      broad_order: '22',
      broad_order_amount: '24',
      broad_roi: '5.33',
      broad_cir: '18.77',
      cr: '4.90',
      cpc: '72164.40',
      direct_order: '17',
      direct_order_amount: '18',
      direct_roi: '3.84',
      direct_cir: '26.04',
      direct_cr: '3.79',
      cpdc: '93389.24',
    },
  });

  assert.equal(campaign.campaign_id, 8811);
  assert.deepEqual(campaign.report, {
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
  });
  assert.equal('direct_gmv' in campaign.report, false);
  assert.equal('date' in campaign.report, false);
});

test('rejects malformed Shop GMV Max campaign envelopes', () => {
  for (const response of [
    null,
    {},
    { campaign_id: 0, report: {} },
    { campaign_id: 8811 },
    { campaign_id: 8811, report: [] },
  ]) {
    assert.throws(
      () => normalizeShopeeGmsCampaignPerformance(response),
      /response tidak valid/,
    );
  }
});

test('accepts fractional campaign impressions but rejects them at item grain', () => {
  const campaign = normalizeShopeeGmsCampaignPerformance({
    campaign_id: 8811,
    report: completeGmsReport({ impression: 1234.5 }),
  });
  assert.equal(campaign.report.impression, 1234.5);

  assert.throws(() => normalizeShopeeGmsItemPerformance({
    campaign_id: 8811,
    result_list: [{
      item_id: 101,
      report: completeGmsReport({ impression: 1234.5 }),
    }],
    total: 1,
    has_next_page: false,
  }), /field report impression tidak valid/);
});

test('normalizes Shop GMV Max item pagination with the requested campaign fallback', () => {
  const page = normalizeShopeeGmsItemPerformance({
    campaign_id: 0,
    result_list: [
      {
        item_id: '101',
        report: completeGmsReport({ impression: '1200', expense: '50000', broad_roi: '4.2' }),
      },
    ],
    total: 1,
    has_next_page: true,
  }, 8811);

  assert.equal(page.campaign_id, 8811);
  assert.equal(page.total, 1);
  assert.equal(page.has_next_page, true);
  assert.equal(page.page_size, 1);
  assert.deepEqual(page.items.map((item) => item.item_id), [101]);
  assert.equal(page.items[0].report.expense, 50_000);
});

test('uses the requested campaign fallback only for missing, null, or zero response ids', () => {
  for (const campaignFields of [
    {},
    { campaign_id: null },
    { campaign_id: 0 },
  ]) {
    const page = normalizeShopeeGmsItemPerformance({
      ...campaignFields,
      result_list: [],
      total: 0,
      has_next_page: false,
    }, 8811);
    assert.equal(page.campaign_id, 8811);
  }
});

test('does not disguise invalid present campaign ids with the request fallback', () => {
  for (const campaignId of [
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    false,
    'abc',
    '',
  ]) {
    assert.throws(() => normalizeShopeeGmsItemPerformance({
      campaign_id: campaignId,
      result_list: [],
      total: 0,
      has_next_page: false,
    }, 8811), /envelope response tidak valid/);
  }
});

test('rejects a malformed Shop GMV Max item without a report object', () => {
  assert.throws(() => normalizeShopeeGmsItemPerformance({
    campaign_id: 8811,
    result_list: [{ item_id: 101 }],
    total: 1,
    has_next_page: false,
  }), /report item tidak valid/);
});

test('rejects missing, non-finite, negative, and fractional GMS count fields', () => {
  const { cpdc: _missingCpdc, ...missingCpdc } = completeGmsReport();
  assert.throws(
    () => normalizeShopeeGmsReport(missingCpdc),
    /field report cpdc tidak tersedia/,
  );

  for (const [field, value] of [
    ['expense', Number.NaN],
    ['broad_gmv', Number.POSITIVE_INFINITY],
    ['broad_roi', -0.01],
    ['clicks', Number.MAX_SAFE_INTEGER + 1],
    ['broad_order', 2.25],
    ['direct_order_amount', -1],
  ] as const) {
    assert.throws(
      () => normalizeShopeeGmsReport(completeGmsReport({ [field]: value })),
      new RegExp(`field report ${field} tidak valid`),
    );
  }
});

test('rejects nonnumeric GMS primitives instead of coercing them to zero', () => {
  for (const [field, value] of [
    ['expense', null],
    ['clicks', false],
    ['cpdc', ''],
    ['cpdc', '   '],
  ] as const) {
    assert.throws(
      () => normalizeShopeeGmsReport({
        ...completeGmsReport(),
        [field]: value,
      }),
      new RegExp(`field report ${field} tidak valid`),
    );
  }
});

test('rejects unsafe or fractional GMS campaign and item ids', () => {
  for (const campaignId of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => normalizeShopeeGmsCampaignPerformance({
        campaign_id: campaignId,
        report: completeGmsReport(),
      }),
      /response tidak valid/,
    );
  }

  for (const itemId of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => normalizeShopeeGmsItemPerformance({
        campaign_id: 8811,
        result_list: [{ item_id: itemId, report: completeGmsReport() }],
        total: 1,
        has_next_page: false,
      }),
      /report item tidak valid/,
    );
  }
});

test('rejects malformed Shop GMV Max item pagination envelopes', () => {
  for (const response of [
    null,
    {},
    { campaign_id: 8811, result_list: {}, total: 0, has_next_page: false },
    { campaign_id: 0, result_list: [], total: 0, has_next_page: false },
    { campaign_id: 8811, result_list: [], total: -1, has_next_page: false },
    { campaign_id: 8811, result_list: [], total: 1.5, has_next_page: false },
    { campaign_id: 8811, result_list: [], total: null, has_next_page: false },
    { campaign_id: 8811, result_list: [], total: '', has_next_page: false },
    { campaign_id: 8811, result_list: [], total: false, has_next_page: false },
    {
      campaign_id: 8811,
      result_list: [],
      total: Number.MAX_SAFE_INTEGER + 1,
      has_next_page: false,
    },
    { campaign_id: 8811, result_list: [], total: 0, has_next_page: 'false' },
  ]) {
    assert.throws(
      () => normalizeShopeeGmsItemPerformance(response),
      /response tidak valid/,
    );
  }
});

test('builds GMS ranges without unsupported one-day chunks', () => {
  assert.deepEqual(buildShopeeGmsDateChunks('2026-09-10', '2026-09-10'), []);
  assert.deepEqual(buildShopeeGmsDateChunks('2026-09-01', '2026-09-29'), [
    { period_start: '2026-09-01', period_end: '2026-09-27' },
    { period_start: '2026-09-28', period_end: '2026-09-29' },
  ]);
  assert.deepEqual(buildShopeeGmsDateChunks('2026-09-01', '2026-09-02'), [
    { period_start: '2026-09-01', period_end: '2026-09-02' },
  ]);
  assert.throws(
    () => buildShopeeGmsDateChunks('2026-09-02', '2026-09-01'),
    /tidak boleh lebih besar/,
  );

  const longRange = buildShopeeGmsDateChunks('2026-01-01', '2026-02-26');
  assert.deepEqual(longRange, [
    { period_start: '2026-01-01', period_end: '2026-01-27' },
    { period_start: '2026-01-28', period_end: '2026-02-24' },
    { period_start: '2026-02-25', period_end: '2026-02-26' },
  ]);
});

test('preserves Shopee API error codes for GMS availability decisions', () => {
  const error = new ShopeeApiError({
    label: 'Shopee GMS campaign performance',
    code: 'ads_error_not_whitelisted_for_product_gms\t',
    message: 'This shop is not whitelisted for Product GMS.',
    requestId: 'request-1',
  });

  assert.equal(getShopeeApiErrorCode(error), 'ads_error_not_whitelisted_for_product_gms');
  assert.equal(isShopeeGmsUnavailableError(error), true);
  assert.match(error.message, /not whitelisted/);
});

test('aggregates non-overlapping GMS chunks without inventing direct GMV', () => {
  const first = normalizeShopeeGmsReport(completeGmsReport({
    impression: 1000,
    clicks: 100,
    expense: 100,
    broad_gmv: 500,
    broad_order: 10,
    broad_order_amount: 12,
    direct_order: 6,
    direct_order_amount: 7,
    direct_roi: 3,
  }));
  const second = normalizeShopeeGmsReport(completeGmsReport({
    impression: 2000,
    clicks: 200,
    expense: 300,
    broad_gmv: 1200,
    broad_order: 20,
    broad_order_amount: 25,
    direct_order: 12,
    direct_order_amount: 14,
    direct_roi: 2,
  }));
  const report = aggregateShopeeGmsReports([first, second]);

  assert.equal(report.impression, 3000);
  assert.equal(report.expense, 400);
  assert.equal(report.broad_gmv, 1700);
  assert.equal(report.broad_roi, 4.25);
  assert.equal(report.broad_cir, (400 / 1700) * 100);
  assert.equal(report.cr, (30 / 300) * 100);
  assert.equal(report.cpc, 400 / 30);
  assert.equal(report.direct_roi, 2.25);
  assert.equal(report.direct_order, 18);
  assert.equal(report.direct_cir, (400 / 900) * 100);
  assert.equal(report.direct_cr, (18 / 300) * 100);
  assert.equal(report.cpdc, 400 / 18);
  assert.equal('direct_gmv' in report, false);
});

test('preserves Shopee-reported ratios for a single GMS response', () => {
  const source = normalizeShopeeGmsReport(completeGmsReport({
    impression: 10,
    clicks: 2,
    expense: 100,
    broad_gmv: 500,
    broad_order: 1,
    broad_order_amount: 2,
    broad_roi: 9.91,
    broad_cir: 10.09,
    cr: 12.34,
    cpc: 56.78,
    direct_order: 1,
    direct_order_amount: 1,
    direct_roi: 7.65,
    direct_cir: 13.07,
    direct_cr: 8.76,
    cpdc: 43.21,
  }));

  const aggregate = aggregateShopeeGmsReports([source]);
  assert.deepEqual(aggregate, source);
  assert.notEqual(aggregate, source);
});

test('paginates GMS items using returned page size and deduplicates item ids', { concurrency: false }, async () => {
  await withMockShopeeFetch([
    {
      response: {
        campaign_id: 8811,
        result_list: [
          { item_id: 102, report: completeGmsReport({ impression: 20, expense: 200 }) },
          { item_id: 101, report: completeGmsReport({ impression: 10, expense: 100 }) },
        ],
        total: 3,
        has_next_page: true,
      },
    },
    {
      response: {
        campaign_id: 8811,
        result_list: [
          { item_id: 102, report: completeGmsReport({ impression: 22, expense: 220 }) },
          { item_id: 103, report: completeGmsReport({ impression: 30, expense: 300 }) },
        ],
        total: 3,
        has_next_page: false,
      },
    },
  ], async (calls) => {
    const result = await getShopeeGmsItemPerformance({
      accessToken: 'token',
      shopId: 227509446,
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      campaignId: 8811,
    });

    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/api\/v2\/ads\/get_gms_item_performance\?/);
    assert.deepEqual(calls.map((call) => JSON.parse(String(call.init?.body))), [
      {
        campaign_id: 8811,
        start_date: '01-09-2026',
        end_date: '10-09-2026',
        offset: 0,
        limit: 100,
      },
      {
        campaign_id: 8811,
        start_date: '01-09-2026',
        end_date: '10-09-2026',
        offset: 2,
        limit: 100,
      },
    ]);
    assert.equal(result.total, 3);
    assert.deepEqual(result.items.map((item) => item.item_id), [101, 102, 103]);
    assert.equal(result.items[1].report.expense, 220);
  });
});

test('rejects incomplete, empty-next, and mismatched GMS item pagination', { concurrency: false }, async () => {
  await withMockShopeeFetch([{
    response: {
      campaign_id: 8811,
      result_list: [{ item_id: 101, report: completeGmsReport() }],
      total: 2,
      has_next_page: false,
    },
  }], async () => {
    await assert.rejects(() => getShopeeGmsItemPerformance({
      accessToken: 'token',
      shopId: 227509446,
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      campaignId: 8811,
    }), /respons tidak lengkap \(1 dari 2 item\)/);
  });

  await withMockShopeeFetch([{
    response: {
      campaign_id: 8811,
      result_list: [],
      total: 2,
      has_next_page: true,
    },
  }], async () => {
    await assert.rejects(() => getShopeeGmsItemPerformance({
      accessToken: 'token',
      shopId: 227509446,
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      campaignId: 8811,
    }), /halaman kosong masih memiliki next page/);
  });

  await withMockShopeeFetch([{
    response: {
      campaign_id: 9900,
      result_list: [],
      total: 0,
      has_next_page: false,
    },
  }], async () => {
    await assert.rejects(() => getShopeeGmsItemPerformance({
      accessToken: 'token',
      shopId: 227509446,
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      campaignId: 8811,
    }), /campaign 9900 tidak cocok dengan 8811/);
  });

  await withMockShopeeFetch([{
    response: {
      campaign_id: 8811,
      result_list: [
        { item_id: 101, report: completeGmsReport() },
        { item_id: 102, report: completeGmsReport() },
      ],
      total: 1,
      has_next_page: false,
    },
  }], async () => {
    await assert.rejects(() => getShopeeGmsItemPerformance({
      accessToken: 'token',
      shopId: 227509446,
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      campaignId: 8811,
    }), /respons tidak lengkap \(2 dari 1 item\)/);
  });
});

test('returns explicit GMS availability statuses without fabricating rows', { concurrency: false }, async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('fetch should not run for a one-day GMS range');
  }) as typeof fetch;
  try {
    assert.deepEqual(await fetchShopeeGmsPerformanceRange({
      accessToken: 'token',
      shopId: 227509446,
      dateStart: '2026-09-10',
      dateEnd: '2026-09-10',
    }), { status: 'range_unavailable', snapshots: [] });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  await withMockShopeeFetch([{
    error: 'ads_error_not_whitelisted_for_product_gms',
    message: 'Shop is not whitelisted.',
    request_id: 'request-1',
  }], async () => {
    assert.deepEqual(await fetchShopeeGmsPerformanceRange({
      accessToken: 'token',
      shopId: 227509446,
      dateStart: '2026-09-01',
      dateEnd: '2026-09-02',
    }), { status: 'not_whitelisted', snapshots: [] });
  });

  await withMockShopeeFetch([{
    error: 'ads_error_product_gms_campaign_not_found',
    message: 'Campaign not found.',
  }], async () => {
    assert.deepEqual(await fetchShopeeGmsPerformanceRange({
      accessToken: 'token',
      shopId: 227509446,
      dateStart: '2026-09-01',
      dateEnd: '2026-09-02',
    }), { status: 'no_campaign', snapshots: [] });
  });

  await withMockShopeeFetch([{
    error: 'error_not_found',
    message: 'Not found.',
  }], async () => {
    assert.deepEqual(await fetchShopeeGmsPerformanceRange({
      accessToken: 'token',
      shopId: 227509446,
      dateStart: '2026-09-01',
      dateEnd: '2026-09-02',
    }), { status: 'sandbox_unavailable', snapshots: [] });
  });

  await withMockShopeeFetch([{
    error: 'error_not_found',
    message: 'Not found.',
  }], async () => {
    process.env.SHOPEE_API_BASE_URL = 'https://partner.shopeemobile.com';
    await assert.rejects(() => fetchShopeeGmsPerformanceRange({
      accessToken: 'token',
      shopId: 227509446,
      dateStart: '2026-09-01',
      dateEnd: '2026-09-02',
    }), /Shopee GMS campaign performance: Not found\./);
  });
});

test('fetches GMS campaign and items into a contract-backed exact-period snapshot', { concurrency: false }, async () => {
  await withMockShopeeFetch([
    {
      response: {
        campaign_id: 8811,
        report: completeGmsReport({
          impression: 1000,
          clicks: 50,
          expense: 100,
          broad_gmv: 500,
          broad_roi: 5,
        }),
      },
    },
    {
      response: {
        campaign_id: 8811,
        result_list: [
          {
            item_id: 202,
            report: completeGmsReport({ impression: 400, expense: 40, broad_gmv: 160 }),
          },
          {
            item_id: 101,
            report: completeGmsReport({ impression: 600, expense: 60, broad_gmv: 340 }),
          },
        ],
        total: 2,
        has_next_page: false,
      },
    },
  ], async (calls) => {
    const result = await fetchShopeeGmsPerformanceRange({
      accessToken: 'token',
      shopId: 227509446,
      dateStart: '2026-09-01',
      dateEnd: '2026-09-10',
    });

    assert.equal(result.status, 'ok');
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/api\/v2\/ads\/get_gms_campaign_performance\?/);
    assert.match(calls[1].url, /\/api\/v2\/ads\/get_gms_item_performance\?/);
    if (result.status !== 'ok') assert.fail('expected an available GMS snapshot');
    assert.equal(result.snapshots.length, 1);
    assert.equal(result.snapshots[0].campaign_id, 8811);
    assert.equal(result.snapshots[0].period_start, '2026-09-01');
    assert.equal(result.snapshots[0].period_end, '2026-09-10');
    assert.equal(result.snapshots[0].report.broad_roi, 5);
    assert.deepEqual(result.snapshots[0].items.map((item) => item.item_id), [101, 202]);
  });
});
