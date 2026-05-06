import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeAdsRows,
  getAdsDateRange,
  getImportPeriodFromAds,
} from '../lib/daily-ads-sync-runner';

test('getAdsDateRange spans the actual ad dates instead of trusting the first row month', () => {
  const range = getAdsDateRange([
    { date: '2026-03-01' },
    { date: '2026-05-04' },
    { date: '2026-04-17' },
  ]);

  assert.deepEqual(range, {
    start: '2026-03-01',
    end: '2026-05-04',
  });

  assert.deepEqual(getImportPeriodFromAds([
    { date: '2026-03-01' },
    { date: '2026-05-04' },
  ]), {
    month: 5,
    year: 2026,
  });
});

test('dedupeAdsRows drops exact duplicate Google Sheets rows', () => {
  const deduped = dedupeAdsRows([
    {
      date: '2026-05-01',
      ad_account: 'Roove - Tiktok Shop - All',
      spent: 21177268,
      source: 'TikTok Ads',
      store: 'Roove',
      advertiser: '',
      data_source: 'google_sheets',
    },
    {
      date: '2026-05-01',
      ad_account: 'Roove - Tiktok Shop - All',
      spent: 21177268,
      source: 'TikTok Ads',
      store: 'Roove',
      advertiser: '',
      data_source: 'google_sheets',
    },
    {
      date: '2026-05-01',
      ad_account: 'Shopee - Roove',
      spent: 2000000,
      source: 'Shopee - Roove',
      store: 'Roove',
      advertiser: '',
      data_source: 'google_sheets',
    },
  ]);

  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped.map((row) => row.ad_account), [
    'Roove - Tiktok Shop - All',
    'Shopee - Roove',
  ]);
});
