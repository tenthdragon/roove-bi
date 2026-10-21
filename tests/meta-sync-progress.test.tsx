import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import type { MetaSyncJob } from '../lib/meta-funnel-sync-status';
Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = (module: any) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) }; };
const MetaSyncProgress = require('../components/MetaSyncProgress').default;
function job(id: string, mode: string, status: string): MetaSyncJob {
  return { id, mode, status, error_message: null, created_at: '2026-10-21T10:00:00Z', started_at: null, completed_at: null, payload: {} };
}
const render = (jobs: MetaSyncJob[]) => renderToStaticMarkup(<MetaSyncProgress progress={null} preparing={false} checking={false}
  status={{ jobs, trackedJobs: null, pending: jobs.filter(j => ['queued', 'running'].includes(j.status)).length }} accounts={[]} error="" onRefresh={() => {}} />);
test('12 completed metadata batches and 7 queued show waiting, not a running spinner', () => {
  const jobs = [...Array.from({ length: 12 }, (_, n) => job(`root-${n}`, 'ad_mapping', 'success')),
    ...Array.from({ length: 7 }, (_, n) => job(`child-${n}`, 'ad_mapping_creatives', 'queued'))];
  const html = render(jobs);
  assert.match(html, /Metadata iklan menunggu antrean/);
  assert.match(html, /12\/19 batch metadata/);
  assert.match(html, /aria-label="Progres metadata" max="19" value="12"/);
  assert.match(html, /lucide-clock/);
  assert.doesNotMatch(html, /syncSpinner|Memperbarui metadata iklan/);
  jobs[12].status = 'running';
  assert.match(render(jobs), /Memperbarui metadata iklan/);
  assert.match(render(jobs), /syncSpinner/);
});
test('discovery only reports running when an inventory job is actually running', () => {
  const queued = job('inventory', 'ad_mapping', 'queued');
  assert.match(render([queued]), /Metadata iklan menunggu antrean/);
  assert.doesNotMatch(render([queued]), /mendeteksi perubahan/);
  assert.match(render([{ ...queued, status: 'running' }]), /mendeteksi perubahan/);
});
test('catalog waiting and terminal metadata outcomes retain meaningful status', () => {
  assert.match(render([job('catalog', 'meta_product_set_verify', 'queued')]), /Katalog menunggu antrean/);
  assert.doesNotMatch(render([job('catalog', 'meta_product_set_verify', 'queued')]), /syncSpinner/);
  assert.match(render([job('catalog', 'meta_product_set_verify', 'running')]), /Memeriksa katalog/);
  assert.match(render([job('metadata', 'ad_mapping_creatives', 'success')]), /Metadata iklan diperbarui/);
  assert.match(render([job('metadata', 'ad_mapping_creatives', 'failed')]), /Metadata iklan dengan kendala/);
});
