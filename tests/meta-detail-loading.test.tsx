import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from 'typescript';
import { useMetaCachedLoad } from '../lib/useMetaCachedLoad';
import { emptyTotals } from '../lib/meta-funnel-domain';
const require = createRequire(import.meta.url), { create, act } = require('react-test-renderer');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: (data: any) => void, reject!: (error: Error) => void; const promise = new Promise<any>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const nothing = () => null, wrap = ({ children }: any) => <>{children}</>;

function harness(failMain = false) {
  let reads = 0, revision = '1'; const pending: { input: any; gate: ReturnType<typeof deferred> }[] = [];
  const period = { from: '2026-10-01', to: '2026-10-28' };
  const totals = { ...emptyTotals(), spend: 100 };
  const data = () => ({ schemaReady: true, workspaceId: 'w', reportVersion: revision, brand: { id: '1', name: 'Roove' },
    reportRange: period, prevFrom: '2026-09-03', prevTo: '2026-09-30', currency: 'IDR', reportingError: null,
    worlds: { website: { spend: 100 }, cpas: { spend: 0 } }, accounts: [], rulesReady: true, matchingAds: 1,
    responseMetrics: [], response: [], unassigned: [], templates: [], highlights: [], coverageGaps: [],
    sections: [{ key: 'one', name: 'Main', config: { metrics: [], stages: [] }, groups: [{ key: 'landing:x', name: 'Main row', current: totals }], summary: totals }] });
  function Table({ section, breakdown, onBreakdownChange }: any) {
    return <><span data-main>{section.groups[0].current.spend}</span><select aria-label="Breakdown" value={breakdown} onChange={e => onBreakdownChange(e.target.value)} />
      {section.groups.map((g: any) => <span key={g.key} data-children>{JSON.stringify(g[breakdown + '_breakdown'])}</span>)}</>;
  }
  const stubs: Record<string, any> = {
    'next/link': wrap, 'next/dynamic': () => nothing,
    'next/navigation': { useParams: () => ({ brandId: '1' }), useSearchParams: () => new URLSearchParams(), useRouter: () => ({}), usePathname: () => '/dashboard/meta-funnels/brand/1' },
    '@/lib/DateRangeContext': { useDateRange: () => ({ dateRange: period }) },
    '@/lib/PermissionsContext': { usePermissions: () => ({ can: () => false, role: 'owner' }) },
    '@/lib/useMetaCachedLoad': { useMetaCachedLoad, useMetaReportSession: () => ({ key: 'u:w', userId: 'u', workspaceId: 'w', error: '' }) },
    '@/lib/useMetaBreakdownPreference': { useMetaBreakdownPreference: () => { const [value, select] = React.useState('format'); return { value, select, ready: true, error: '' }; } },
    '@/lib/meta-funnel-actions': { getMetaReportRevision: async () => ({ workspaceId: 'w', reportVersion: revision }), getMetaFunnelHistory: async () => ({ schemaReady: true, history: [] }) },
    '@/lib/meta-brand-actions': { getMetaBrandDetail: async () => { if (++reads === 1 && failMain) return { reportError: 'Main timeout' }; return data(); },
      getMetaBrandBreakdown: (input: any) => { const gate = deferred(); pending.push({ input, gate }); return gate.promise; } },
    '@/lib/meta-column-preference-actions': { getMetaColumnPreferences: async () => ({ ready: true, preferences: {} }) },
    '@/lib/meta-inline-highlights': { brandMetricHighlights: () => [], metaDataNotes: () => [] },
    '@/components/MetaInsightPopover': { MetaDataNotesTrigger: nothing, MetaHighlightValue: wrap },
    '@/components/MetaHighlightPreviewContext': { MetaHighlightPreviewProvider: wrap },
    '@/components/MetaAnalysisFilters': { default: nothing, MetaActiveFilters: nothing, __esModule: true },
    '@/components/MetaTemplateResults': Table,
  };
  const file = new URL('../app/dashboard/meta-funnels/brand/[brandId]/page.tsx', import.meta.url), pageRequire = createRequire(file);
  const source = transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports: any = {};
  new Function('require','exports','React',source)((name: string) => name in stubs ? stubs[name] : name.endsWith('.css') ? {} : name.startsWith('@/components/') ? nothing : pageRequire(name),exports,React);
  return { Page: exports.default, pending, reads: () => reads, setRevision: (value: string) => { revision=value; },
    result: (kind: string, value: string, version = revision) => ({ schemaReady: true, workspaceId: 'w', reportVersion: version, breakdown: kind,
      groups: [{ key: 'landing:x', [kind + '_breakdown']: [{ label: value }] }] }) };
}

test('main content stays usable while only the selected child loads; stale children never cross selections', async () => {
  const oldWindow = globalThis.window; Object.assign(globalThis, { window: { setTimeout, clearTimeout } });
  const h = harness(); let root: any;
  try {
    await act(async () => { root = create(<h.Page/>); await tick(); });
    assert.equal(root.root.findByProps({ 'data-main': true }).children[0], '100');
    assert.equal(h.reads(), 1); assert.equal(h.pending.length, 1); assert.equal(h.pending[0].input.breakdown, 'format');
    await act(async () => root.root.findByProps({ 'aria-label': 'Breakdown' }).props.onChange({ target: { value: 'optimization' } }));
    assert.equal(h.pending.length, 2); assert.equal(h.reads(), 1);
    await act(async () => { h.pending[0].gate.resolve(h.result('format', 'obsolete child')); await tick(); });
    assert.ok(!JSON.stringify(root.toJSON()).includes('obsolete child'));
    await act(async () => { h.pending[1].gate.reject(new Error('Child timeout')); await tick(); });
    assert.equal(root.root.findByProps({ 'data-main': true }).children[0], '100');
    assert.match(JSON.stringify(root.toJSON()), /Child timeout/);
    await act(async () => root.root.findAllByType('button').find((b: any) => b.children.includes('Coba lagi')).props.onClick());
    assert.equal(h.pending.length, 3); assert.equal(h.reads(), 1);
    await act(async () => { h.pending[2].gate.resolve(h.result('optimization', 'current child')); await tick(); });
    assert.match(JSON.stringify(root.toJSON()), /current child/);
    await act(async () => root.root.findByProps({ 'aria-label': 'Breakdown' }).props.onChange({ target: { value: 'none' } }));
    assert.equal(h.pending.length, 3); assert.ok(!JSON.stringify(root.toJSON()).includes('current child'));
  } finally { await act(async () => root?.unmount()); Object.assign(globalThis, { window: oldWindow }); }
});

test('a main report failure has a working retry and does not start child requests first', async () => {
  const oldWindow = globalThis.window; Object.assign(globalThis, { window: { setTimeout, clearTimeout } });
  const h = harness(true); let root: any;
  try {
    await act(async () => { root=create(<h.Page/>); await tick(); });
    assert.equal(h.pending.length, 0); assert.match(JSON.stringify(root.toJSON()), /Main timeout/);
    await act(async () => { root.root.findAllByType('button').find((b: any) => b.children.includes('Coba lagi')).props.onClick(); await tick(); });
    assert.equal(h.reads(), 2); assert.equal(h.pending.length, 1);
    assert.equal(root.root.findByProps({ 'data-main': true }).children[0], '100');
  } finally { await act(async () => root?.unmount()); Object.assign(globalThis, { window: oldWindow }); }
});
