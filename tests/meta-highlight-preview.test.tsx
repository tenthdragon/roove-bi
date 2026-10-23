import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMetaLeakSnapshots } from '../lib/meta-highlight-snapshot';
import { leakFixture } from './fixtures/meta-leak-snapshot';

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
const { create, act } = require('react-test-renderer');
const Preview = require('../components/MetaHighlightCardPreview').default;
const { MetaHighlightPreviewProvider, useMetaHighlightPreview } = require('../components/MetaHighlightPreviewContext');
const { MetaHighlightValue, MetaInsightPopover } = require('../components/MetaInsightPopover');

test('preview renders safe text, evidence, warning status and no destination or send control', () => {
  const input = leakFixture();
  input.report.brand.name = '<img src=x onerror=alert(1)>';
  input.report.sections[0].groups[0].name = '[click](javascript:alert(1))';
  input.report.coverageGaps = [{ account_id: 'act_example', currentMissing: 1, baselineMissing: 0 }];
  const snapshot = createMetaLeakSnapshots(input)[0];
  const html = renderToStaticMarkup(<Preview snapshot={snapshot} onClose={() => {}} />);
  assert.match(html, /PRATINJAU · TIDAK DIKIRIM/); assert.match(html, /TERTAHAN/);
  assert.match(html, /1\.01%/); assert.match(html, /1\.56%/); assert.match(html, /-35\.6%/);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|<script|dangerouslySetInnerHTML/);
  assert.doesNotMatch(html, /href="javascript:|>Kirim</);
  assert.match(html, /Tujuan, assignee, dan notifikasi belum dikonfigurasi/);
  assert.match(html, /Unduh snapshot JSON/); assert.match(html, /belum tersedia/);
});

test('only exact matching leak evidence receives the preview action; existing detail action remains', async () => {
  const input = leakFixture(), snapshots = createMetaLeakSnapshots(input);
  const leak = input.report.highlights.find(h => h.kind === 'leak')!;
  let root: any;
  const render = (highlights = [leak]) => <MetaHighlightPreviewProvider snapshots={snapshots}>
    <MetaHighlightValue highlights={highlights} currency="IDR" onDetail={() => {}} />
  </MetaHighlightPreviewProvider>;
  await act(async () => { root = create(render()); });
  // The popover is closed; inspect its content contract without opening a DOM portal.
  const content = () => renderToStaticMarkup(<>{root.root.findByType(MetaInsightPopover).props.children}</>);
  assert.match(content(), /Pratinjau kartu Basecamp/); assert.match(content(), /Lihat detail/);
  await act(async () => root.update(render([{ ...leak, kind: 'weak_response' }])));
  assert.doesNotMatch(content(), /Pratinjau kartu Basecamp/);
  await act(async () => root.update(render([{ ...leak, groupKey: 'other' }])));
  assert.doesNotMatch(content(), /Pratinjau kartu Basecamp/);
  await act(async () => root.unmount());
});

test('opening, downloading and closing is local-only; scope invalidation removes the modal', async () => {
  const originals = Object.fromEntries(['document', 'window', 'HTMLElement', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  let file: Blob | undefined, clicks = 0, modalOpens = 0, modalCloses = 0, filename = '', revoked = '';
  const anchor = { href: '', download: '', click() { clicks++; filename = this.download; }, remove() {} };
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { activeElement: null, createElement: () => anchor, body: { append() {} } } },
    window: { configurable: true, value: { setTimeout: (fn: () => void) => { fn(); return 1; } } },
    HTMLElement: { configurable: true, value: class {} },
    fetch: { configurable: true, value: () => { throw new Error('Preview must not use the network'); } },
  });
  URL.createObjectURL = blob => { file = blob as Blob; return 'blob:preview'; };
  URL.revokeObjectURL = value => { revoked = value; };
  const input = leakFixture(), snapshots = createMetaLeakSnapshots(input);
  function Trigger() { const action = useMetaHighlightPreview()(input.report.highlights.find(h => h.kind === 'leak')!); return <button onClick={action}>Open fixture</button>; }
  let root: any;
  const render = (items = snapshots) => <MetaHighlightPreviewProvider snapshots={items}><Trigger /></MetaHighlightPreviewProvider>;
  try {
    await act(async () => { root = create(render(), { createNodeMock: (node: any) => node.type === 'dialog' ? { showModal() { modalOpens++; }, close() { modalCloses++; } } : null }); });
    await act(async () => root.root.findByType('button').props.onClick());
    assert.equal(modalOpens, 1);
    const download = () => root.root.findAllByType('button').find((b: any) => b.children.includes('Unduh snapshot JSON'));
    await act(async () => download().props.onClick());
    assert.equal(clicks, 1); assert.equal(revoked, 'blob:preview'); assert.equal(file?.type, 'application/json');
    const exported = JSON.parse(await file!.text());
    assert.deepEqual(exported.snapshot, snapshots[0]); assert.equal(exported.card.body_format, 'plain_text');
    assert.equal(filename, `meta-leak-${snapshots[0].snapshot_id}.json`);
    await act(async () => root.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
    assert.equal(root.root.findAllByType('dialog').length, 0); assert.equal(modalCloses, 1);
    await act(async () => root.root.findByType('button').props.onClick());
    await act(async () => root.update(render([])));
    assert.equal(root.root.findAllByType('dialog').length, 0, 'No stale preview across revocation/scope changes');
    await act(async () => root.update(render()));
    assert.equal(root.root.findAllByType('dialog').length, 0, 'Restored data does not resurrect a dismissed preview');
  } finally {
    if (root) await act(async () => root.unmount());
    for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
  }
});
