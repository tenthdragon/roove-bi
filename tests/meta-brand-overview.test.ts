import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { emptyTotals, defaultFunnel, type SavedFunnel } from '../lib/meta-funnel-domain';
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
    accounts, brands: [{ id: 1, name: 'Brand A' }], configuredAccounts: accounts, funnels: [] as SavedFunnel[], jobs: [],
    config: defaultFunnel(), reportRange: { from: '2026-10-01', to: '2026-10-19' }, filters };
  const rules: any[] = [];
  const stubs: Record<string, unknown> = {
    './meta-report-context': { reportContext: async (input: any) => { assert.deepEqual(input.filters, filters); return ctx; } },
    './service-supabase': { createServiceSupabase: () => ({}) },
    './meta-funnel-store': { loadTemplateRules: async () => ({ ready: true, rows: rules }) },
    './meta-ad-report-data': { getCachedMetaBrandOverviewReport: async (...args: unknown[]) => {
      assert.deepEqual(args, ['workspace', '7', '2026-10-01', '2026-10-19', filters, [1]]);
      return { reports: [{ brand: '1', channel: 'non_cpas', report: website }, { brand: '1', channel: 'cpas', report: cpas }],
        cepSpend: [], facets: [], facetTotals: {}, cepLabels: {} };
    }, getCachedMetaBrandDetailReport: async (...args: unknown[]) => {
      assert.deepEqual(args, ['workspace', '7', '2026-10-01', '2026-10-19', '1', 'non_cpas', filters]);
      return { website, cpas, cep: emptyMetaBrandReport() };
    } },
  };
  const file = new URL('../lib/meta-brand-actions.ts', import.meta.url), require = createRequire(file);
  const source = transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const api: any = {};
  new Function('require', 'exports', source)((name: string) => Object.hasOwn(stubs, name) ? stubs[name] : require(name), api);
  const overview = async () => (await api.getMetaBrandOverview({ ...ctx.reportRange, workspaceId: 'workspace', filters })).brands[0];
  const detail = async (workspaceId = 'workspace') => api.getMetaBrandDetail({ ...ctx.reportRange, brandId: '1', world: 'website', workspaceId, filters });
  return { website, overview, detail, ctx, rules };
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

test('brand detail returns all row findings with metric evidence, while overview still limits its ranked summary', async () => {
  const { website, overview, detail, ctx, rules } = harness();
  const config = { ...defaultFunnel(), id: 'template', updated_at: '' };
  ctx.funnels.push(config);
  rules.push({ id: 'rule', funnel_id: config.id, match_kind: 'domain', pattern: 'example.com' });
  website.groups = Array.from({ length: 8 }, (_, index) => ({ key: `landing:${index}`, name: `https://example.com/${index}`,
    current: { ...emptyTotals(), spend: 100, impressions: 10000, outbound_clicks: 20 },
    previous: { ...emptyTotals(), spend: 100, impressions: 10000, outbound_clicks: 200 },
    ad_ids: [String(index)], ad_names: ['Ad'], accounts: ['Account'], landing_page_urls: [`https://example.com/${index}`], verified_ad_ids: [] }));
  website.summary = { ...emptyTotals(), spend: 800, impressions: 80000, outbound_clicks: 160 };
  website.previous = { ...emptyTotals(), spend: 800, impressions: 80000, outbound_clicks: 1600 };
  const report = await detail();
  const leaks = report.highlights.filter((h: any) => h.kind === 'leak');
  assert.equal(leaks.length, 8);
  assert.equal(report.leakSnapshots.length, 8, 'Snapshots use every detail finding, not the overview top 3');
  assert.ok(report.leakSnapshots.every((s: any) => s.scope.workspace.id === ctx.workspaceId && s.scope.brand.id === '1'
    && s.scope.filters.intention === 'cons' && s.source.revision === ctx.reportVersion && s.mode === 'preview_only'));
  assert.ok(leaks.every((h: any) => h.metric.numerator === 'outbound_clicks' && h.comparison.basis === 'period'));
  assert.equal(report.highlights.some((h: any) => h.kind === 'stable'), false);
  assert.equal((await overview()).highlights.length, 3);
});

test('snapshot response follows the existing authenticated workspace check and mixed-currency suppression', async () => {
  const { detail, website } = harness();
  await assert.rejects(detail('other-workspace'), /Workspace berubah/);
  website.currencies = ['IDR', 'USD'];
  const report = await detail();
  assert.ok(report.reportingError); assert.deepEqual(report.leakSnapshots, []);
});
