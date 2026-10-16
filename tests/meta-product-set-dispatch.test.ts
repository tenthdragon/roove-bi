import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSyncJob } from '../lib/sync-job-runners';
import type { SyncJobRecord } from '../lib/sync-jobs';

test('malformed product-set jobs reject before falling through to spend or inventory sync', async () => {
  const base = { job_name: 'meta_sync', mode: 'meta_product_set_verify', workspace_id: '00000000-0000-4000-8000-000000000001' };
  const valid = { ad_mapping_only: true, verify_shopee_product_set: true, account_id: 'act_123', product_set_id: '456' };
  for (const payload of [{}, { ...valid, verify_shopee_product_set: false }, { ...valid, ad_mapping_only: false },
    { ...valid, account_id: 'another-account' }, { ...valid, product_set_id: '' },
    { ...valid, product_set_id: ['456'] }, { ...valid, creative_ad_ids: ['1'] }, { ...valid, ad_funnels_only: true }]) {
    await assert.rejects(executeSyncJob({ ...base, payload } as SyncJobRecord), /Payload verifikasi/);
  }
  await assert.rejects(executeSyncJob({ ...base, mode: 'cron', payload: { verify_shopee_product_set: false } } as SyncJobRecord), /Payload verifikasi/);
});
