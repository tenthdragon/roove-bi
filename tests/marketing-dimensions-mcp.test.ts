import test from 'node:test';
import assert from 'node:assert/strict';
import { readDimensionCatalog, readAll } from '../mcp-server/src/marketing-dimensions';
import { readSpend } from '../mcp-server/src/marketing-spend-tools';
import { readFunnelReport } from '../mcp-server/src/meta-funnel-tools';

const workspace = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const period = { from: '2026-10-20', to: '2026-10-21' };
function fixture(cap = 1000) {
  const reads: any[] = [];
  const data: Record<string, any[]> = {
    workspaces: [{ id: workspace, slug: 'roove', name: 'Roove Workspace' }, { id: other, name: 'Other' }],
    brands: [{ id: 1, name: 'Roove' }, { id: 3, name: 'Pluve' }, { id: 7, name: 'Inactive', is_active: false }],
    scalev_webhook_businesses: [{ id: 10, business_code: 'RLB' }, { id: 20, business_code: 'RTI' }],
    scalev_store_channels: [{ id: 28, business_id: 20, store_name: 'Roove Main Store' }, { id: 59, business_id: 20, store_name: 'Roove Extra Store' }, { id: 8, business_id: 10, store_name: 'Roove Main Store' }],
    business_brand_roles: [{ id: 1, business_id: 10, brand_id: 1, role: 'owner', is_active: true }, { id: 2, business_id: 20, brand_id: 1, role: 'seller', is_active: true }],
    brand_aliases: [{ id: 1, brand_id: 3, alias: 'Plume', provider: 'legacy_ads', alias_type: 'store', is_active: true }],
    daily_ads_spend: [
      { id: 1, brand_id: 1, business_code: null, ad_account: 'A', store: 'Roove', spent: 100, impressions: 10 },
      { id: 2, brand_id: 1, business_code: 'RTI', ad_account: 'A', store: 'Old label', spent: -50, impressions: 90 },
      { id: 3, brand_id: 3, business_code: 'RLB', ad_account: 'B', store: 'Plume', spent: 30, impressions: 0 },
      { id: 4, brand_id: 3, business_code: 'RLB', ad_account: 'C', store: 'Pluve', spent: 20, impressions: 10 },
      { id: 5, brand_id: null, business_code: null, ad_account: 'Roove-looking-name', store: 'Roove', spent: 500, impressions: 50 },
      { id: 6, brand_id: 1, business_code: 'RTI', ad_account: 'TikTok', store: 'Roove', spent: 300, impressions: 100, data_source: 'google_sheets', source: 'TikTok Ads' },
    ],
  };
  for (const [table, rows] of Object.entries(data)) for (const row of rows) {
    if (table !== 'workspaces') row.workspace_id = workspace;
    if (table === 'daily_ads_spend') { row.date = '2026-10-21'; row.source ??= 'Facebook Ads'; row.data_source ??= 'meta_api'; }
  }
  data.daily_ads_spend.push({ ...data.daily_ads_spend[0], id: 99, workspace_id: other, spent: 99999 });
  const errors: Record<string, string> = {};
  const db = { from(table: string) {
    const filters: any[] = []; let start = 0, end = 999, key = 'id'; let columns = '';
    const query: any = {
      select(c: string, opts: any) { columns = c; assert.equal(opts.count, 'exact'); return query; },
      eq(k: string, v: any) { filters.push([k, 'eq', v]); return query; },
      gte(k: string, v: any) { filters.push([k, 'gte', v]); return query; },
      lte(k: string, v: any) { filters.push([k, 'lte', v]); return query; },
      order(k: string) { key = k; return query; }, range(s: number, e: number) { start = s; end = e; return query; },
      then(resolve: any) {
        reads.push({ table, filters, columns, start });
        const rows = (data[table] || []).filter(r => filters.every(([k, op, v]) => op === 'eq' ? r[k] === v : op === 'gte' ? r[k] >= v : r[k] <= v)).sort((a, b) => a[key] < b[key] ? -1 : 1);
        return Promise.resolve({ data: rows.slice(start, Math.min(end + 1, start + cap)), count: rows.length, error: errors[table] ? { message: errors[table] } : null }).then(resolve);
      },
    }; return query;
  } };
  return { db: db as any, data, reads, errors };
}

test('catalog separates workspace, many-to-many business roles, brand aliases and business-owned stores', async () => {
  const m = fixture(1); const c = await readDimensionCatalog(m.db, workspace);
  assert.equal(c.workspace.name, 'Roove Workspace'); assert.equal(c.stores.length, 3);
  assert.equal(c.business_brand_roles.length, 2); assert.equal(c.brand_aliases[0].brand_id, 3);
  assert.equal(c.brands.at(-1).is_active, false);
  assert.ok(m.reads.every(r => r.filters.some(([key, , value]: any[]) => key === (r.table === 'workspaces' ? 'id' : 'workspace_id') && value === workspace)));
  assert.ok(m.reads.every(r => !/\*|secret|api_key/.test(r.columns)));
});
test('canonical brand aggregates differing legacy labels, never current account defaults or name substrings', async () => {
  const m = fixture(1); const r = await readSpend(m.db, workspace, { ...period, brand_id: '3' }, true);
  assert.equal(r.totals?.spent, 50); assert.equal(r.filters.brand_id, '3');
  assert.equal(r.status, 'partial_attribution'); assert.equal(r.attribution?.unknown_rows, 1);
  assert.deepEqual((r as any).accounts.map((a: any) => a.ad_account), ['B', 'C']);
});
test('business filter uses only recorded business_code; owner/seller roles never expand spend', async () => {
  const m = fixture(); const r = await readSpend(m.db, workspace, { ...period, business_code: 'RLB', brand_id: '1' }, true);
  assert.equal(r.status, 'unavailable_attribution'); assert.equal(r.totals, null);
  assert.equal(r.attribution?.unknown_rows, 2);
});
test('brand/business intersection uses matching rows and warns about missing attribution', async () => {
  const m = fixture(); const r = await readSpend(m.db, workspace, { ...period, brand_id: '1', business_code: 'RTI' }, true);
  assert.equal(r.totals?.spent, 50); assert.equal(r.totals?.impressions, 90);
  assert.equal(r.status, 'partial_attribution');
});
test('workspace total includes all brands, not a same-named brand or another tenant', async () => {
  const m = fixture(); const r = await readSpend(m.db, workspace, period, true);
  assert.equal(r.totals?.spent, 700); assert.equal(r.status, 'ok');
});
test('operational Main and Extra stores cannot be answered with brand totals', async () => {
  const m = fixture();
  for (const store_id of [28, 59]) {
    const r = await readSpend(m.db, workspace, { ...period, store_id }, true);
    assert.equal(r.status, 'unsupported_dimension'); assert.equal(r.totals, null);
    assert.equal(r.scope.store.id, store_id);
  }
  assert.ok(!m.reads.some(r => r.table === 'daily_ads_spend'));
  await assert.rejects(readSpend(m.db, workspace, { ...period, store_id: 28, business_code: 'RLB' }), /different business/);
});
test('invalid identities and ambiguous legacy store fail rather than broadening', async () => {
  const m = fixture();
  for (const scope of [{ brand_id: '999' }, { business_code: 'Unknown' }, { store_id: 999 }, { store: 'Roove' }]) {
    await assert.rejects(readSpend(m.db, workspace, { ...period, ...scope }), /not found|Ambiguous/);
  }
  assert.ok(!m.reads.some(r => r.table === 'daily_ads_spend'));
});
test('tenant assertion is enforced before any read on both spend and funnel reports', async () => {
  const m = fixture();
  await assert.rejects(readSpend(m.db, workspace, { ...period, workspace_id: other }), /Workspace/);
  await assert.rejects(readFunnelReport(m.db, workspace, { ...period, workspace_id: other }), /Workspace/);
  assert.equal(m.reads.length, 0);
});
test('funnel rejects business/store filters instead of silently stripping them', async () => {
  const m = fixture();
  for (const scope of [{ business_code: 'RTI' }, { store_id: 28 }, { store: 'Roove' }]) await assert.rejects(readFunnelReport(m.db, workspace, { ...period, ...scope }), /do not support/);
  assert.equal(m.reads.length, 0);
});
test('CPM uses ratio of sums and Meta scope excludes other ingestion channels', async () => {
  const m = fixture(); const r = await readSpend(m.db, workspace, { ...period, brand_id: '1', include_daily: true }, true);
  assert.equal(r.totals?.spent, 150); assert.equal(r.totals?.impressions, 100); assert.equal(r.totals?.avg_cpm, 1500);
  assert.equal((r as any).accounts[0].daily[0].spent, 150);
  const all = await readSpend(m.db, workspace, { ...period, brand_id: '1' }); assert.equal(all.totals?.spent, 450);
});
test('zero impressions gives null CPM; no rows returns null total, not invented zero', async () => {
  const m = fixture(); const r = await readSpend(m.db, workspace, { ...period, ad_account: 'B' }, true);
  assert.equal(r.totals?.avg_cpm, null);
  const empty = await readSpend(m.db, workspace, { ...period, source: '%Facebook%' });
  assert.equal(empty.status, 'no_rows'); assert.equal(empty.totals, null);
});
test('catalog errors and missing count fail closed', async () => {
  const m = fixture(); m.errors.brand_aliases = 'permission denied';
  await assert.rejects(readSpend(m.db, workspace, period), /permission denied/);
  const q: any = { order: () => q, range: () => Promise.resolve({ data: [{ id: 1 }], count: null }) };
  await assert.rejects(readAll(() => q), /Exact row count/);
});
test('caps, incomplete pages and changing datasets cannot produce partial totals', async () => {
  for (const [pages, message] of [
    [[{ data: [], count: 50001 }], /safe row limit/],
    [[{ data: [], count: 2 }], /Incomplete/],
    [[{ data: [{ id: 1 }], count: 2 }, { data: [{ id: 2 }], count: 3 }], /changed/],
    [[{ data: [{ id: 1 }], count: 2 }, { data: [{ id: 1 }], count: 2 }], /Unstable/],
  ] as const) {
    let i = 0; const q: any = { order: () => q, range: () => Promise.resolve(pages[i++]) };
    await assert.rejects(readAll(() => q), message);
  }
});
test('invalid dates and overlong ranges are rejected', async () => {
  const m = fixture();
  for (const p of [{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-10-22', to: '2026-10-21' }, { from: '2026-01-01', to: '2026-10-21' }]) await assert.rejects(readSpend(m.db, workspace, p));
  assert.equal(m.reads.length, 0);
});
