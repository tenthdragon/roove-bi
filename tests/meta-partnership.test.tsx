import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { partnershipMetadata } from '../lib/meta-ad-partnership';
import { fetchCreativeBatch } from '../lib/meta-ad-insights';
import { partnershipGroups, compareMetrics, type TemplateGroup } from '../lib/meta-funnel-templates';
import { emptyTotals, defaultFunnel } from '../lib/meta-funnel-domain';
import { useMetaBreakdownPreference } from '../lib/useMetaBreakdownPreference';
Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_t, n) => String(n) }) }; };
const { create, act } = require('react-test-renderer');
const Results = require('../components/MetaTemplateResults').default;
test('either sponsor is sufficient; names, actor IDs and numeric ad_format are never partnership proof', () => {
  for (const evidence of [{ facebook_branded_content: { sponsor_page_id: '21' } }, { instagram_branded_content: { sponsor_id: '22' } },
    { facebook_branded_content: { sponsor_page_id: '21' }, instagram_branded_content: { sponsor_id: '22' } }, { branded_content_sponsor_page_id: '23' }]) {
    assert.equal(partnershipMetadata({ id: '11', ...evidence }, true).status, 'partnership');
  }
  assert.equal(partnershipMetadata({ id: '11', name: 'Partnership UGC', actor_id: '12', instagram_user_id: '13' }, true).status, 'non_partnership');
  for (const creative of [{}, { id: '11', branded_content: { ad_format: 3 } }, { id: '11', facebook_branded_content: { sponsor_page_id: 'invalid' } },
    { id: '11', instagram_branded_content: { sponsor_id: '0' } }, { id: '11', facebook_branded_content: 'opaque' }]) assert.equal(partnershipMetadata(creative, true).status, 'unknown');
  assert.equal(partnershipMetadata({ id: '11' }).status, 'unknown', 'Legacy cache is never treated as checked');
  assert.equal(partnershipMetadata({ id: '11', facebook_branded_content: null, instagram_branded_content: {} }, true).status, 'non_partnership');
  assert.equal(JSON.stringify(partnershipMetadata({ id: '11', branded_content: { ad_format: 3, instagram_boost_post_access_token: 'SECRET' } }, true)).includes('SECRET'), false);
});
const item = (body: object, code = 200) => ({ code, body: JSON.stringify(body) });
test('successful safe query inspects sponsorship; optional-field failure preserves format but cannot classify non-partnership', async () => {
  const original = globalThis.fetch, calls: string[][] = [];
  const responses = [[item({ id: '1', creative: { id: '11', image_hash: 'image', instagram_branded_content: { sponsor_id: '22' } } }), item({ error: { code: 3 } }, 400), item({ id: '3', creative: { id: '33', video_id: '44' } })],
    [item({ id: '2', creative: { id: '22', image_hash: 'image' } })]];
  globalThis.fetch = (async (_url, init) => { const batch = JSON.parse((init!.body as URLSearchParams).get('batch')!); calls.push(batch.map((b: any) => b.relative_url)); return Response.json(responses.shift()); }) as typeof fetch;
  try {
    const rows = await fetchCreativeBatch(['1', '2', '3'], 'secret');
    assert.deepEqual(rows.map(r => 'error' in r ? 'error' : r.partnership_metadata.status), ['partnership', 'unknown', 'non_partnership']);
    assert.deepEqual(rows.map(r => 'error' in r ? 'error' : r.creative_format), ['image', 'image', 'video']);
    assert.equal(calls.length, 2); assert.equal(calls[1].length, 1);
    assert.ok(calls[0].every(p => p.includes('branded_content{ad_format}') && !p.includes('access_token') && !p.includes('sponsor_relationship')));
    assert.ok(!calls[1][0].includes('branded_content'));
  } finally { globalThis.fetch = original; }
});
const totals = (x: object) => ({ ...emptyTotals(), ...x });
const config = defaultFunnel();
const group: TemplateGroup = { key: 'landing:https://example.com', name: 'https://example.com', ad_ids: ['1','2','3'], accounts: ['A'], ad_names: [], landing_page_urls: [], verified_ad_ids: [], metrics: [],
  current: totals({ spend: 600, purchases: 6 }), previous: totals({ spend: 300, purchases: 2 }),
  format_breakdown: [{ format: 'image', ad_ids: ['1','2','3'], current: totals({ spend: 600, purchases: 6 }), previous: totals({ spend: 300, purchases: 2 }) }],
  partnership_breakdown: [
    { status: 'non_partnership', ad_ids: ['2'], current: totals({ spend: 300, purchases: 2 }), previous: totals({ spend: 100, purchases: 1 }) },
    { status: 'unknown', ad_ids: ['3'], current: totals({ spend: 100, purchases: 0 }), previous: totals({ spend: 100, purchases: 0 }) },
    { status: 'partnership', ad_ids: ['1'], current: totals({ spend: 200, purchases: 4 }), previous: totals({ spend: 100, purchases: 1 }) },
  ] };
group.metrics = compareMetrics(group.current, group.previous, config.metrics);
test('partnership children preserve counts and summed-event CPP including zero purchase', () => {
  const rows = partnershipGroups(group, config.metrics);
  assert.deepEqual(rows.map(r => r.name), ['Partnership','Non-partnership','Belum diketahui']);
  assert.deepEqual(rows.map(r => r.metrics.find(m => m.id === 'cpp')?.current), [50,150,null]);
  assert.deepEqual(rows.map(r => r.metrics.find(m => m.id === 'cpp')?.previous), [100,100,null]);
  assert.equal(rows.reduce((n,r) => n+r.current.spend,0), group.current.spend);
  assert.equal(rows.flatMap(r => r.ad_ids).length, group.ad_ids.length);
});
test('existing dropdown switches to partnership, replaces children and keeps configured columns and parent', async () => {
  let root: any, selected = '';
  const section = { key: 's', funnelId: 's', name: 'Test', kind: 'transaction', config, groups: [group], summary: group.current, previous: group.previous, metrics: group.metrics, mainMetric: null, mainMedian: null };
  const props = { section, world: 'website', currency: 'IDR', preferencesReady: true, onOpenGroup: () => {}, onSave: async () => {}, onBreakdownChange: (v: string) => { selected=v; } };
  await act(async () => { root = create(<Results {...props}/>); });
  const dropdown = root.root.findByProps({ 'aria-label': 'Breakdown tabel Test' });
  assert.ok(root.root.findByProps({ 'aria-label': 'Tampilan tabel Test' }).findAllByType('button').some((b:any) => b.children.includes('Atur kolom')));
  assert.ok(dropdown.findAllByType('option').some((o:any) => o.props.value==='partnership'));
  await act(async () => dropdown.props.onChange({ target: { value: 'partnership' } })); assert.equal(selected, 'partnership');
  const parentBefore = root.root.findByType('tbody').findAllByType('tr')[0].findAllByType('td').length;
  await act(async () => root.update(<Results {...props} breakdown="partnership"/>));
  const rows = root.root.findByType('tbody').findAllByType('tr');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].findAllByType('td').length, parentBefore);
  assert.ok(rows.slice(1).every((r:any) => r.findAllByType('td').length === rows[0].findAllByType('td').length-1));
  const text = JSON.stringify(root.toJSON()); assert.match(text,/Non-partnership/); assert.match(text,/Belum diketahui/); assert.doesNotMatch(text,/"Image"/);
  await act(async () => dropdown.props.onChange({ target: { value: 'none' } })); assert.equal(selected, 'none');
  await act(async () => root.unmount());
});
test('partnership preference survives remount and remains scoped to user/workspace', async () => {
  const oldWindow = globalThis.window, store = new Map<string,string>(); let state: ReturnType<typeof useMetaBreakdownPreference>, root:any;
  Object.assign(globalThis,{window:{localStorage:{getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v)}}});
  function Probe({user='u'}:{user?:string}) { state=useMetaBreakdownPreference('w',user); return null; }
  try {
    await act(async()=>{root=create(<Probe/>);}); await act(async()=>state!.select('partnership'));
    await act(async()=>root.unmount()); await act(async()=>{root=create(<Probe/>);}); assert.equal(state!.value,'partnership');
    await act(async()=>root.update(<Probe user="another"/>)); assert.equal(state!.value,'format');
  } finally { await act(async()=>root.unmount()); Object.assign(globalThis,{window:oldWindow}); }
});

test('fallback outage preserves successful sponsorship; wrong ad identities are rejected', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => {
    if (++calls > 1) throw Error('provider unavailable');
    return Response.json([item({id:'1',creative:{id:'11',video_id:'99',facebook_branded_content:{sponsor_page_id:'21'}}}),item({error:{code:3}},400),item({id:'999',creative:{id:'33',video_id:'99'}})]);
  }) as typeof fetch;
  try {
    const rows=await fetchCreativeBatch(['1','2','3'],'secret');
    assert.deepEqual(rows.map(r=>'error' in r ? 'error' : r.partnership_metadata.status),['partnership','error','error']);
  } finally {globalThis.fetch=original;}
});
