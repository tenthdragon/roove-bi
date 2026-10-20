import test from 'node:test';
import assert from 'node:assert/strict';
import { readFunnelReport, reportRange, reportSchema } from '../mcp-server/src/meta-funnel-tools';

const workspace = 'roove-test';
function mock(currencies = ['IDR']) {
  const scopes: unknown[][] = []; let rpcArgs: any;
  const data: Record<string, any> = {
    meta_ad_funnels: [{ id: '12345678-1234-4234-8234-123456789012', config: { group_by: 'landing_page', account_ids: ['act_1'], name_filter: 'test', match: 'contains' } }],
    meta_ad_accounts: [{ account_id: 'act_1', default_brand_id: 1 }], brands: [{ id: 1, name: 'Roove' }], meta_ad_report_versions: { revision: 42 },
  };
  const db = { from(table: string) {
    const q: any = { select: () => q, eq: (...args: any[]) => { scopes.push([table, ...args]); return q; }, order: () => q, maybeSingle: () => q,
      then: (resolve: any) => Promise.resolve({ data: data[table], error: null }).then(resolve) }; return q;
  }, rpc: async (name: string, args: any) => { assert.equal(name, 'get_meta_ad_report'); rpcArgs = args; return { data: { currencies, summary: { spend: 100 }, previous: { spend: 80 }, groups: [{ key: 'a' }, { key: 'b' }], history: [], creatives: [], coverage: [] }, error: null }; } };
  return { db: db as any, scopes, data, args: () => rpcArgs };
}
test('matches completed-day range and rejects invalid or overlong dates', () => {
  assert.deepEqual(reportRange('2026-10-16', '2026-10-16', '2026-10-16'), { from: '2026-10-15', to: '2026-10-15' });
  assert.throws(() => reportRange('2026-02-30', '2026-03-01', '2026-10-16'));
  assert.throws(() => reportRange('2026-01-01', '2026-10-15', '2026-10-16'));
  assert.throws(() => reportSchema.parse({ from: '2026-10-15', to: '2026-10-15', limit: 201 }));
});
test('scopes every context read and RPC; preserves totals while paginating; reports coverage gaps', async () => {
  const m = mock();
  const r = await readFunnelReport(m.db, workspace, { from: '2026-10-15', to: '2026-10-16', filters: { cep: 'Sendi', intention: 'Conversion' }, brand_id: '1', limit: 1, offset: 1 }, '2026-10-16');
  for (const table of ['meta_ad_funnels', 'meta_ad_accounts', 'brands', 'meta_ad_report_versions']) assert.ok(m.scopes.some(s => s[0] === table && s[1] === 'workspace_id' && s[2] === workspace));
  assert.equal(m.args().p_workspace_id, workspace);
  assert.equal(m.args().p_to, '2026-10-15');
  assert.deepEqual(m.args().p_filters, { cep: 'joint', intention: 'conv' });
  assert.deepEqual(m.args().p_config.account_ids, ['act_1']);
  assert.deepEqual(r.report.groups, [{ key: 'b' }]); assert.equal(r.report.summary.spend, 100);
  assert.deepEqual(r.coverage_gaps, [{ account_id: 'act_1', current_missing: 1, previous_missing: 1 }]);
});
test('rejects another workspace funnel and unavailable brands before calling reporting RPC', async () => {
  const m = mock();
  await assert.rejects(readFunnelReport(m.db, workspace, { from: '2026-10-15', to: '2026-10-15', funnel_id: '12345678-1234-4234-8234-999999999999' }), /Funnel not found/);
  await assert.rejects(readFunnelReport(m.db, workspace, { from: '2026-10-15', to: '2026-10-15', brand_id: '2' }), /Brand not available/);
  assert.equal(m.args(), undefined);
});
test('prevents comparing mixed-currency monetary totals', async () => {
  const m = mock(['IDR', 'USD']);
  await assert.rejects(readFunnelReport(m.db, workspace, { from: '2026-10-15', to: '2026-10-15' }), /multiple currencies/);
});
test('does not invent coverage gaps for history responses that omit coverage rows', async () => {
  const m = mock();
  const r = await readFunnelReport(m.db, workspace, { from: '2026-10-15', to: '2026-10-15', view: 'daily' }, '2026-10-16');
  assert.equal(r.coverage_gaps, null);
});

test('brand-owned all-account funnels stay within their brand through MCP', async () => {
  const m=mock();
  m.data.meta_ad_funnels[0].brand_id=1;
  m.data.meta_ad_funnels[0].config.account_ids=[];
  m.data.meta_ad_accounts.push({account_id:'act_2',default_brand_id:2});
  m.data.brands.push({id:2,name:'Other'});
  await readFunnelReport(m.db,workspace,{from:'2026-10-15',to:'2026-10-15'});
  assert.deepEqual(m.args().p_config.account_ids,['act_1']);
  assert.equal(m.args().p_brand,'1');
  await assert.rejects(readFunnelReport(m.db,workspace,{from:'2026-10-15',to:'2026-10-15',brand_id:'2'}),/another brand/);
  m.data.meta_ad_accounts=m.data.meta_ad_accounts.filter((a:any)=>a.default_brand_id!==1);
  await readFunnelReport(m.db,workspace,{from:'2026-10-15',to:'2026-10-15'});
  assert.deepEqual(m.args().p_config.account_ids,['__no_authorized_meta_account__']);
});
