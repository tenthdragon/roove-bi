import test from 'node:test';
import assert from 'node:assert/strict';
import { mappingSyncFeedback, loadMetaAdMappingSyncJobs } from '../lib/meta-ad-mapping-sync-status';
import type { MetaSyncJob } from '../lib/meta-funnel-sync-status';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function job(n: number, status = 'success', patch: Partial<MetaSyncJob> = {}): MetaSyncJob {
  return { id: id(n), status, mode: 'ad_mapping', error_message: null, created_at: '2026-10-20T14:08:00Z', started_at: null,
    completed_at: status === 'success' ? '2026-10-20T14:11:00Z' : null, payload: { ad_mapping_only: true, account_id: 'act_1' }, ...patch };
}
test('inventory completion waits for late creative/catalog children and shows success only after all batches finish', () => {
  const roots = Array.from({ length: 12 }, (_, n) => id(n));
  const inventory = roots.map((_, n) => job(n));
  assert.equal(mappingSyncFeedback(roots, [...inventory, job(20, 'queued', { mode: 'ad_mapping_creatives' })], 1).active, true);
  assert.match(mappingSyncFeedback(roots, [...inventory, job(20)], 0).text, /^Sync selesai\. Semua batch/);
  assert.equal(mappingSyncFeedback(roots, [...inventory, job(20)], 0).issue, false);
});
test('failures older than the recent ten jobs remain visible while running and after completion', () => {
  const jobs = Array.from({ length: 25 }, (_, n) => job(n));
  jobs[0] = job(0, 'failed', { error_message: 'Meta tidak dapat dihubungi.' });
  const active = mappingSyncFeedback([id(0)], [...jobs, job(30, 'running')], 1);
  assert.equal(active.active, true); assert.equal(active.issue, true); assert.match(active.text, /1 gagal/);
  const done = mappingSyncFeedback([id(0)], jobs, 0);
  assert.equal(done.active, false); assert.match(done.text, /Sync selesai dengan kendala.*1 gagal/);
  assert.match(done.details.join(' '), /Meta tidak dapat dihubungi/);
});
test('partial, canceled and successful-with-warning batches do not masquerade as a clean success', () => {
  for (const j of [job(1, 'partial'), job(1, 'canceled'), job(1, 'success', { result_summary: { warnings: ['Tujuan belum terbaca.'] } })]) {
    const result = mappingSyncFeedback([id(1)], [j], 0);
    assert.equal(result.issue, true); assert.equal(result.active, false); assert.equal(result.details.length, 1);
    assert.match(result.text, /dengan kendala/);
  }
});
test('missing roots, unknown states and not-yet-loaded status never report success', () => {
  for (const jobs of [null, [], [job(1, 'unexpected')]]) {
    const result = mappingSyncFeedback([id(1)], jobs, 0);
    assert.equal(result.active, true); assert.doesNotMatch(result.text, /Sync selesai/);
  }
  assert.equal(mappingSyncFeedback([id(1)], [job(1, 'running')], 0).active, true, 'Count/read race must keep polling');
});
test('tree loader scopes all reads, includes children beyond preview, and rejects foreign or non-mapping roots', async () => {
  const rows = Array.from({ length: 12 }, (_, n) => job(n));
  const metric = job(50, 'success', { payload: { date_start: '2026-10-01' } });
  let calls = 0;
  const svc: any = {
    from(table: string) {
      assert.equal(table, 'sync_jobs'); const filters: any = {};
      const q: any = { select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, in: (_k: string, ids: string[]) => { filters.ids = ids; return q; },
        then: (resolve: any) => { assert.equal(filters.workspace_id, 'workspace-a'); assert.equal(filters.job_name, 'meta_sync'); resolve({ data: [...rows, metric].filter(j => filters.ids.includes(j.id)), error: null }); } };
      return q;
    },
    rpc: async (name: string, args: any) => {
      calls++; assert.equal(name, 'get_meta_sync_job_tree'); assert.equal(args.p_workspace_id, 'workspace-a');
      assert.deepEqual(args.p_root_ids, rows.map(j => j.id));
      return { data: [...rows, job(100, 'failed', { mode: 'ad_mapping_creatives' }), metric], error: null };
    },
  };
  const tree = await loadMetaAdMappingSyncJobs(svc, 'workspace-a', [...rows.map(j => j.id), id(50), id(999)]);
  assert.equal(tree.length, 13); assert.equal(tree.at(-1)?.status, 'failed');
  assert.deepEqual(await loadMetaAdMappingSyncJobs(svc, 'workspace-a', [id(999), id(50)]), []);
  assert.equal(calls, 1);
  await assert.rejects(loadMetaAdMappingSyncJobs(svc, 'workspace-a', ['invalid']), /tidak valid/);
});
