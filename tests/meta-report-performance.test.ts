import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { mergeMetaBreakdown } from '../lib/meta-report-breakdown';
import { defaultFunnel, emptyTotals } from '../lib/meta-funnel-domain';

function loadActions(stubs: Record<string, unknown>): any {
  const file = new URL('../lib/meta-brand-actions.ts', import.meta.url), require = createRequire(file);
  const source = transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const api = {};
  new Function('require', 'exports', source)((name: string) => Object.hasOwn(stubs, name) ? stubs[name] : require(name), api);
  return api;
}

test('deferred children preserve all parent totals, order and assignments; missing rows clear old children', () => {
  const totals = { ...emptyTotals(), spend: 100 };
  const groups = [{ key: 'b', current: totals, name: 'B', assignment: 'template-1', format_breakdown: [{ format: 'video' as const, ad_ids: ['1'], current: totals, previous: totals }] },
    { key: 'a', current: totals, name: 'A', assignment: 'template-2', format_breakdown: [] }];
  const rows: any[] = [{ key: 'a', current: { spend: 999 }, name: 'Outdated', partnership_breakdown: [] }, { key: 'foreign' }];
  const actual = mergeMetaBreakdown(groups, rows);
  assert.deepEqual(actual.map(g => [g.key, g.name, g.assignment]), [['b', 'B', 'template-1'], ['a', 'A', 'template-2']]);
  assert.ok(actual.every(g => g.current === totals)); assert.deepEqual(actual[0].format_breakdown, []);
  assert.equal(groups[0].format_breakdown.length, 1, 'The main navigation cache is immutable');
});

test('breakdown action reauthorizes and keys report data by current workspace, revision, dates, accounts and filters', async () => {
  const filters = { format: 'video' as const, intention: 'cons' };
  const input = { brandId: '1', workspaceId: 'w', from: '2026-10-01', to: '2026-10-28', filters, breakdown: 'partnership' };
  let reads = 0, authorized = 0;
  const ctx = { schemaReady: true, workspaceId: 'w', reportVersion: '17', scopedAccountIds: ['act_1'], config: defaultFunnel(),
    reportRange: { from: input.from, to: input.to }, input: { from: input.from, to: input.to, filters } };
  const api = loadActions({
    './meta-report-context': { reportContext: async (query: unknown) => { authorized++; assert.deepEqual(query, { from: input.from, to: input.to, brandId: '1', filters }); return ctx; } },
    './meta-ad-report-data': { getCachedMetaBreakdownReport: async (workspace: string, revision: string, query: any) => {
      reads++; assert.equal(authorized, reads); assert.equal(workspace, 'w'); assert.equal(revision, ctx.reportVersion);
      assert.deepEqual(query.config.account_ids, ctx.scopedAccountIds.length ? ctx.scopedAccountIds : ['__no_authorized_meta_account__']);
      assert.equal(query.config.breakdown, 'partnership'); assert.equal(query.config.breakdown_only, true);
      assert.equal(query.brand, '1'); assert.equal(query.channel, 'non_cpas'); assert.equal(query.filters.format, 'video');
      assert.equal(query.from, input.from); assert.equal(query.to, input.to);
      return { currencies: ['IDR'], groups: [{ key: 'landing:x', partnership_breakdown: [] }] };
    } },
  });
  const first = await api.getMetaBrandBreakdown(input);
  assert.equal(first.reportVersion, '17'); assert.equal(first.groups.length, 1);
  ctx.reportVersion = '18'; ctx.scopedAccountIds = [];
  const second = await api.getMetaBrandBreakdown(input); assert.equal(second.reportVersion, '18');
  await assert.rejects(api.getMetaBrandBreakdown({ ...input, workspaceId: 'foreign' }), /Workspace berubah/);
  assert.equal(reads, 2);
  await assert.rejects(api.getMetaBrandBreakdown({ ...input, breakdown: 'all' }), /tidak valid/);
});

test('denied brand access never reaches the breakdown cache', async () => {
  const api = loadActions({ './meta-report-context': { reportContext: async () => { throw Error('Forbidden brand'); } },
    './meta-ad-report-data': { getCachedMetaBreakdownReport: () => assert.fail('Must authorize first') } });
  await assert.rejects(api.getMetaBrandBreakdown({ brandId: '2', from: '2026-10-01', to: '2026-10-28', breakdown: 'format' }), /Forbidden brand/);
});
