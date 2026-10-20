import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { emptyTotals, defaultFunnel } from '../lib/meta-funnel-domain';
import { emptyMetaBrandReport } from '../lib/meta-brand-report';

function harness() {
  const website = { ...emptyMetaBrandReport(), currencies: ['IDR'], matchingAds: 2,
    summary: { ...emptyTotals(), spend: 1200, checkout: 6, leads: 100 },
    previous: { ...emptyTotals(), spend: 800, checkout: 2 } };
  const cpas = { ...emptyMetaBrandReport(), currencies: ['IDR'], matchingAds: 1,
    summary: { ...emptyTotals(), spend: 10000, checkout: 2, purchases: 1 } };
  const filters = { intention: 'cons' };
  const accounts = [{ account_id: 'act_1', default_brand_id: 1 }];
  const ctx = { schemaReady: true, workspaceId: 'workspace', reportVersion: '7', accessKey: 'brand-1', brandIds: [1],
    accounts, brands: [{ id: 1, name: 'Brand A' }], configuredAccounts: accounts, funnels: [], jobs: [],
    config: defaultFunnel(), reportRange: { from: '2026-10-01', to: '2026-10-19' }, filters };
  const stubs: Record<string, unknown> = {
    './meta-report-context': { reportContext: async (input: any) => { assert.deepEqual(input.filters, filters); return ctx; } },
    './service-supabase': { createServiceSupabase: () => ({}) },
    './meta-funnel-store': { loadTemplateRules: async () => ({ ready: true, rows: [] }) },
    './meta-ad-report-data': { getCachedMetaBrandOverviewReport: async (...args: unknown[]) => {
      assert.deepEqual(args, ['workspace', '7', '2026-10-01', '2026-10-19', filters, [1]]);
      return { reports: [{ brand: '1', channel: 'non_cpas', report: website }, { brand: '1', channel: 'cpas', report: cpas }],
        cepSpend: [], facets: [], facetTotals: {}, cepLabels: {} };
    } },
  };
  const file = new URL('../lib/meta-brand-actions.ts', import.meta.url), require = createRequire(file);
  const source = transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const api: any = {};
  new Function('require', 'exports', source)((name: string) => Object.hasOwn(stubs, name) ? stubs[name] : require(name), api);
  const overview = async () => (await api.getMetaBrandOverview({ ...ctx.reportRange, workspaceId: 'workspace', filters })).brands[0];
  return { website, overview };
}

test('overview CPIC uses scoped website totals without a Lead template, excludes CPAS and compares the prior period', async () => {
  const { overview } = harness(); const brand = await overview();
  assert.deepEqual(brand.website.cpic, { id: 'cpic', current: 200, previous: 400, change: -50 });
  assert.equal(brand.website.templates, 0);
  assert.equal(brand.cpas.cpp.current, 10000);
  assert.equal(brand.spend.total, 11200);
  assert.equal('cpl' in brand.website, false);
});
test('zero checkouts show no cost or delta, while zero spend with checkouts remains a valid zero', async () => {
  const { website, overview } = harness(); website.summary.checkout = 0;
  assert.deepEqual((await overview()).website.cpic, { id: 'cpic', current: null, previous: 400, change: null });
  website.summary.checkout = 1; website.summary.spend = 0; website.previous.checkout = 0;
  assert.deepEqual((await overview()).website.cpic, { id: 'cpic', current: 0, previous: null, change: null });
});
test('mixed website currencies suppress CPIC instead of publishing an invalid combined cost', async () => {
  const { website, overview } = harness(); website.currencies = ['IDR', 'USD'];
  const brand = await overview();
  assert.ok(brand.reportingError); assert.equal(brand.website.cpic.current, null); assert.equal(brand.website.cpic.change, null);
});
