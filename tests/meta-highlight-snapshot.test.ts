import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaLeakSnapshots } from '../lib/meta-highlight-snapshot';
import { renderMetaLeakCard } from '../lib/meta-highlight-card';
import { brandHighlights, META_STAGE_LEAK_RULE } from '../lib/meta-ad-highlights';
import { leakFixture } from './fixtures/meta-leak-snapshot';

test('captures the full raw leak evidence, exact scope, periods, currency and versioned rule', () => {
  const input = leakFixture();
  const [snapshot] = createMetaLeakSnapshots(input);
  assert.equal(snapshot.mode, 'preview_only');
  assert.equal(snapshot.schema_version, 'meta-funnel.leak-snapshot/v1');
  assert.deepEqual(snapshot.rule, META_STAGE_LEAK_RULE);
  assert.equal(snapshot.scope.workspace.id, input.report.workspaceId);
  assert.equal(snapshot.scope.brand.id, '1');
  assert.deepEqual(snapshot.scope.group.ad_ids, ['101', '102']);
  assert.equal(snapshot.scope.business, null); assert.equal(snapshot.scope.store, null);
  assert.equal(snapshot.period.timezone, 'Asia/Jakarta');
  assert.deepEqual(snapshot.period.current, input.report.reportRange);
  assert.equal(snapshot.period.reference.from, input.report.prevFrom);
  assert.equal(snapshot.finding.spend.current, 2246788);
  assert.equal(snapshot.finding.spend.currency, 'IDR');
  assert.deepEqual(snapshot.finding.evidence, { current: { numerator: 1006, denominator: 100000 }, reference: { numerator: 1562, denominator: 100000 } });
  assert.equal(snapshot.finding.comparison.current, 1006 / 100000);
  assert.equal(snapshot.finding.comparison.change_percent, (1006 / 100000 - 1562 / 100000) / (1562 / 100000) * 100);
  assert.equal(snapshot.quality.status, 'ready_for_review');
  assert.equal(snapshot.source.snapshot_url, null, 'No fictional permanent snapshot link');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test('rounding is presentation-only; relative change is never recomputed from rounded display ratios', () => {
  const snapshot = createMetaLeakSnapshots(leakFixture())[0];
  const card = renderMetaLeakCard(snapshot);
  assert.equal(card.comparison.current.value, '1.01%');
  assert.equal(card.comparison.reference.value, '1.56%');
  assert.equal(card.change, '-35.6%');
  assert.notEqual(card.change, `${((1.01 - 1.56) / 1.56 * 100).toFixed(1)}%`);
  assert.match(card.body, /bukan estimasi kerugian/);
  assert.match(card.body, /belum menetapkan penyebab/);
  assert.match(card.body, /Filter: Tanpa filter tambahan/);
  assert.match(card.body, /bukan waktu sync/);
  assert.equal(card.body_format, 'plain_text');
});

test('capture time is metadata; identity survives recapture and revisions do not create new findings', () => {
  const input = leakFixture();
  const before = createMetaLeakSnapshots(input)[0];
  const recaptured = createMetaLeakSnapshots({ ...input, generatedAt: '2026-10-22T04:00:00Z' })[0];
  assert.equal(before.finding_id, recaptured.finding_id);
  assert.equal(before.snapshot_id, recaptured.snapshot_id);
  assert.notEqual(before.generated_at, recaptured.generated_at);
  input.report.reportVersion = '43';
  const revised = createMetaLeakSnapshots(input)[0];
  assert.equal(revised.finding_id, before.finding_id);
  assert.notEqual(revised.snapshot_id, before.snapshot_id);
});

test('fractional attributed events remain visible in evidence instead of rounding to whole purchases', () => {
  const input = leakFixture(), section = input.report.sections[0], group = section.groups[0];
  section.config.stages = ['outbound_clicks', 'purchases'];
  group.current.purchases = 10.5; group.previous.purchases = 20.75;
  input.report.highlights = brandHighlights({ world: 'website', sections: [section], summary: group.current, previous: group.previous, currency: 'IDR' });
  const card = renderMetaLeakCard(createMetaLeakSnapshots(input)[0]);
  assert.equal(card.comparison.current.evidence, '10,5 ÷ 1.006');
  assert.equal(card.comparison.reference.evidence, '20,75 ÷ 1.562');
});

test('canonical ordering and empty filters do not change IDs, while scope changes do', () => {
  const input = leakFixture();
  const first = createMetaLeakSnapshots({ ...input, filters: { cep: 'health', intention: 'disc' } })[0];
  const reordered = createMetaLeakSnapshots({ ...input, filters: { intention: 'disc', cep: 'health', objective: '' } })[0];
  assert.equal(first.finding_id, reordered.finding_id); assert.equal(first.snapshot_id, reordered.snapshot_id);
  const base = createMetaLeakSnapshots(input)[0];
  for (const mutate of [
    (i: typeof input) => { i.report.workspaceId = 'other'; },
    (i: typeof input) => { i.report.brand.id = '2'; },
    (i: typeof input) => { i.report.world = 'cpas'; },
    (i: typeof input) => { i.report.accounts[0].account_id = 'other'; },
    (i: typeof input) => { i.report.reportRange.from = '2026-10-20'; },
  ]) {
    const other = leakFixture(); mutate(other);
    assert.notEqual(createMetaLeakSnapshots(other)[0].finding_id, base.finding_id);
  }
  assert.notEqual(first.finding_id, base.finding_id);
});

test('snapshot holds detached evidence and does not mutate or share mutable report objects', () => {
  const input = leakFixture(), original = JSON.stringify(input);
  const snapshot = createMetaLeakSnapshots(input)[0];
  assert.equal(JSON.stringify(input), original);
  input.report.brand.name = 'Changed'; input.report.sections[0].groups[0].ad_ids.push('103');
  input.report.sections[0].groups[0].current.spend = 1;
  assert.equal(snapshot.scope.brand.name, 'Example brand');
  assert.deepEqual(snapshot.scope.group.ad_ids, ['101', '102']);
  assert.equal(snapshot.finding.spend.current, 2246788);
});

test('both coverage windows and the WIB day boundary gate readiness but preserve a blocked preview', () => {
  for (const gap of [{ currentMissing: 1, baselineMissing: 0 }, { currentMissing: 0, baselineMissing: 1 }]) {
    const input = leakFixture(); input.report.coverageGaps = [{ account_id: 'act_example', ...gap }];
    const snapshot = createMetaLeakSnapshots(input)[0];
    assert.equal(snapshot.quality.status, 'blocked'); assert.match(snapshot.quality.blockers.join(' '), /belum lengkap/);
    assert.match(renderMetaLeakCard(snapshot).body, /TERTAHAN/);
  }
  const input = leakFixture();
  const open = createMetaLeakSnapshots({ ...input, generatedAt: '2026-10-21T16:59:59Z' })[0];
  const closed = createMetaLeakSnapshots({ ...input, generatedAt: '2026-10-21T17:00:00Z' })[0];
  assert.equal(open.quality.status, 'blocked'); assert.equal(open.quality.closed_period, false);
  assert.equal(closed.quality.status, 'ready_for_review'); assert.equal(closed.quality.closed_period, true);
});

test('currency, unmapped scope, report errors and unavailable website rules fail closed', () => {
  for (const mutate of [
    (i: ReturnType<typeof leakFixture>) => { i.currencies = ['IDR', 'USD']; },
    (i: ReturnType<typeof leakFixture>) => { i.currencies = []; },
    (i: ReturnType<typeof leakFixture>) => { i.report.brand.id = '__unmapped__'; },
    (i: ReturnType<typeof leakFixture>) => { i.report.accounts = []; },
    (i: ReturnType<typeof leakFixture>) => { i.report.rulesReady = false; },
    (i: ReturnType<typeof leakFixture>) => { i.report.reportingError = 'Laporan tidak valid'; },
  ]) {
    const input = leakFixture(); mutate(input);
    const snapshot = createMetaLeakSnapshots(input)[0];
    assert.equal(snapshot.quality.status, 'blocked'); assert.ok(snapshot.quality.blockers.length);
  }
});

test('null, non-finite, negative, small or mismatched evidence cannot produce a snapshot', () => {
  for (const value of [null, NaN, Infinity, -1, 0, 29]) {
    const input = leakFixture(); input.report.sections[0].groups[0].current.impressions = value as number;
    assert.deepEqual(createMetaLeakSnapshots(input), []);
  }
  for (const value of [null, NaN, Infinity, -1, 0]) {
    const input = leakFixture(); input.report.sections[0].groups[0].previous.outbound_clicks = value as number;
    assert.deepEqual(createMetaLeakSnapshots(input), []);
  }
  const input = leakFixture(); input.report.highlights.find(h => h.kind === 'leak')!.comparison!.current = 123;
  assert.deepEqual(createMetaLeakSnapshots(input), []);
});

test('non-leaks and mismatched group/template/formula evidence never acquire a preview', () => {
  for (const mutate of [
    (h: ReturnType<typeof leakFixture>['report']['highlights'][number]) => { h.kind = 'weak_response'; },
    (h: ReturnType<typeof leakFixture>['report']['highlights'][number]) => { h.groupKey = 'foreign'; },
    (h: ReturnType<typeof leakFixture>['report']['highlights'][number]) => { h.sectionKey = 'foreign'; },
    (h: ReturnType<typeof leakFixture>['report']['highlights'][number]) => { h.metric!.numerator = 'purchases'; },
    (h: ReturnType<typeof leakFixture>['report']['highlights'][number]) => { h.metric!.multiplier = 100; },
    (h: ReturnType<typeof leakFixture>['report']['highlights'][number]) => { h.comparison!.basis = 'brand_average'; },
  ]) {
    const input = leakFixture(); mutate(input.report.highlights.find(h => h.kind === 'leak')!);
    assert.deepEqual(createMetaLeakSnapshots(input), []);
  }
});

test('report-level mapping warnings remain visible without inventing business/store attribution', () => {
  const input = leakFixture(); input.report.destinations = { missing_ads: 2, multi_ads: 1 }; input.report.objectiveUnknownAds = 3;
  const snapshot = createMetaLeakSnapshots(input)[0];
  assert.equal(snapshot.quality.notes.length, 3);
  assert.equal(snapshot.scope.business, null); assert.equal(snapshot.scope.store, null);
  const card = renderMetaLeakCard(snapshot);
  assert.match(card.body, /2 ad dalam laporan belum memiliki URL/);
  assert.match(card.body, /Business\/store: tidak ditentukan/);
});
