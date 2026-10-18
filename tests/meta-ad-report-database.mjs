// Only the fixed local Docker clone is accessible; no remote connection option.
// Install the report migrations before running; the fixture transaction always rolls back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { compareGroups, defaultFunnel, totalFacts, withLandingPages, destinationQuality, trend, hasCoverage, shiftDay, daysBetween } from '../lib/meta-funnel-domain.ts';
import { withAdDimensions, matchesAdDimensions, dimensionOptions } from '../lib/meta-ad-dimensions.ts';
import { metaBrandAccountIds, metaBrandOptions } from '../lib/meta-ad-brands.ts';
import { metaReportGroups, metaReportOptions, metaReportHistory } from '../lib/meta-ad-report.ts';
let sql = await readFile(new URL('meta-ad-report-db.sql', import.meta.url), 'utf8');
if (process.argv.includes('--with-migration')) {
  const migration = (await readFile(new URL('../supabase/migrations/203_meta_ad_report_performance.sql', import.meta.url), 'utf8')).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
  sql = sql.replace('CREATE TEMP TABLE report_test_scope', () => `${migration}\nCREATE TEMP TABLE report_test_scope`);
}
if (process.argv.includes('--with-cep-migration')) {
  const migration = (await readFile(new URL('../supabase/migrations/216_meta_cep_intention_report_groups.sql', import.meta.url), 'utf8')).replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
  sql = sql.replace('CREATE TEMP TABLE report_test_scope', () => `${migration}\nCREATE TEMP TABLE report_test_scope`);
}
const output = execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'roove-meta-report-test',
  'psql', '-U', 'supabase_admin', '-X', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'],
  { input: sql, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const data = JSON.parse(output);
const enriched = withAdDimensions(withLandingPages(data.facts, data.creatives || [], data.verified || []), data.mappings || []);
const sortedGroups = rows => rows.map(g => ({ ...g, creatives: [], ad_names: [...g.ad_names].sort(), ad_ids: [...g.ad_ids].sort(),
  accounts: [...g.accounts].sort(), verified_ad_ids: [...g.verified_ad_ids].sort(), categories: g.categories.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) })).sort((a, b) => a.key.localeCompare(b.key));
for (const { name, params: p, raw } of data.cases) {
  const config = { ...defaultFunnel(), ...p.config, group_by: p.groupBy === 'ad' ? 'ad_id' : p.groupBy === 'cep_intention' ? 'cep_intention' : 'landing_page' };
  const configured = data.accounts.filter(a => config.account_ids.includes(a.account_id));
  const ids = metaBrandAccountIds(configured, data.brands, p.brandId);
  const start = p.view === 'trends' ? shiftDay(p.to, -89) : p.view === 'daily' ? shiftDay(p.from, -1) : shiftDay(p.from, -daysBetween(p.from, p.to));
  const named = enriched.filter(r => config.account_ids.includes(r.account_id) && r.metric_date >= start && r.metric_date <= p.to
    && (!config.name_filter || (config.match === 'exact' ? r.ad_name === config.name_filter : r.ad_name.includes(config.name_filter))));
  const branded = named.filter(r => ids.includes(r.account_id));
  const rows = branded.filter(r => matchesAdDimensions(r, p.filters));
  if (p.view === 'overview') {
    assert.deepEqual(sortedGroups(metaReportGroups(raw, config)), sortedGroups(compareGroups(rows, config, p.from, p.to)), `${name}: groups`);
    assert.deepEqual(raw.summary, totalFacts(rows.filter(r => r.metric_date >= p.from)), `${name}: summary`);
    assert.deepEqual(raw.previous, totalFacts(rows.filter(r => r.metric_date < p.from)), `${name}: previous`);
    const expectedOptions = dimensionOptions((data.mappings || []).filter(m => ids.includes(m.account_id)), branded.filter(r => r.metric_date >= p.from), p.filters);
    const options = metaReportOptions(raw, data.accounts, data.brands);
    assert.deepEqual(options.dimensionOptions, expectedOptions, `${name}: facet counts and zero-count choices`);
    assert.deepEqual(options.brandOptions, metaBrandOptions(data.accounts, data.brands, named.filter(r => r.metric_date >= p.from && matchesAdDimensions(r, p.filters))), `${name}: brand counts`);
    const quality = destinationQuality(rows, config, p.from, p.to);
    for (const key of ['urls', 'missing_ads', 'multi_ads']) assert.equal(raw.destinations[key], quality[key], `${name}: URL quality ${key}`);
    assert.equal(raw.matchingAds, new Set(rows.filter(r => r.metric_date >= p.from).map(r => `${r.account_id}:${r.ad_id}`)).size, `${name}: ad count`);
    assert.equal(raw.history, null, `${name}: no eager trend query`);
    assert.equal(raw.creatives, null, `${name}: no eager creative bodies`);
  } else if (p.view === 'creatives') {
    const ads = new Set(rows.filter(r => (config.group_by === 'ad_id' ? `ad:${r.account_id}:${r.ad_id}` : r.landing_page_urls.length === 1 ? `landing:${r.landing_page_urls[0]}` : r.landing_page_urls.length ? `landing:multi:${JSON.stringify(r.landing_page_urls)}` : 'landing:unknown') === p.groupKey).map(r => `${r.account_id}:${r.ad_id}`));
    assert.deepEqual(raw.creatives, (data.creatives || []).filter(c => ads.has(`${c.account_id}:${c.ad_id}`)), `${name}: creative scope`);
    assert.equal(raw.groups, null); assert.equal(raw.history, null);
  } else {
    const period = p.view === 'daily' ? 'day' : p.period;
    const expected = trend(rows, config, start, p.to, period, p.groupKey).map(point => {
      const end = period === 'day' ? point.date : period === 'week' ? shiftDay(point.date, 6) : new Date(Date.UTC(Number(point.date.slice(0, 4)), Number(point.date.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const complete = hasCoverage(data.coverage, ids, [point.date, start].sort()[1], [end, p.to].sort()[0]);
      return { ...point, complete, partial: start > point.date || end > p.to, metrics: complete ? point.metrics : Object.fromEntries(config.metrics.map(m => [m.id, null])) };
    });
    const points = p.view === 'daily' ? expected.slice(1).map((v, i) => ({ ...v, previousMetrics: expected[i].metrics })) : expected;
    assert.deepEqual(metaReportHistory(raw, config, p.view), points, `${name}: history totals, coverage, partial buckets, comparison`);
    assert.equal(raw.groups, null); assert.equal(raw.facets, null);
  }
  console.log(`PASS: ${name}`);
}
assert.equal(data.otherWorkspace.matchingAds, 0, 'No cross-workspace fixture leakage');
assert.deepEqual(data.otherWorkspace.groups, []);
console.log('PASS: cross-workspace isolation, cache revisions, failed sync rollback, zero-delivery invalidation, and restricted grants');
