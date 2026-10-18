import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStagingRequest } from '../deploy/staging/network-guard.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
test('staging permits only staging API and dedicated local staging ports', () => {
  for (const url of ['https://staging-app.rti-hq.com/supabase/rest/v1/brands', 'http://127.0.0.1:55431/health']) assert.doesNotThrow(() => assertStagingRequest(url));
  for (const url of ['https://hpsenndhoyzgnnkrhtly.supabase.co/rest/v1/brands', 'https://graph.facebook.com/', 'http://127.0.0.1:3000/', 'https://app.rti-hq.com/', 'https://staging-app.rti-hq.com/api/sync', 'https://staging-app.rti-hq.com.evil.test/supabase/rest/v1']) assert.throws(() => assertStagingRequest(url));
  assert.throws(() => assertStagingRequest({hostname:'app.rti-hq.com',protocol:'https:'}));
  assert.throws(() => assertStagingRequest('https://staging-app.rti-hq.com/supabase/rest/v1', {path:'/api/sync'}));
  assert.throws(() => assertStagingRequest('https://staging-app.rti-hq.com/supabase/rest/v1', {headers:{Host:'app.rti-hq.com'}}));
});
test('staging database services have internal networking and no published ports', () => {
  const source=readFileSync(new URL('../deploy/staging/compose.yml',import.meta.url),'utf8');
  assert.match(source,/internal: true/);
  assert.doesNotMatch(source, /ports:/);
  assert.equal((source.match(/ipv4_address: 172\.30\.88\./g)||[]).length,5);
  assert.doesNotMatch(source,/hpsenndhoyzgnnkrhtly/);
});
test('systemd preserves the complete Node preload value and it blocks production requests', () => {
  const source = readFileSync(new URL('../deploy/staging/roove-bi-staging.service', import.meta.url), 'utf8');
  // systemd splits unquoted Environment assignments on whitespace.
  const line = source.split('\n').find(line => line.startsWith('Environment="NODE_OPTIONS='));
  assert.ok(line?.endsWith('"'), 'The memory option and guard import must be one quoted assignment');
  const options = line.slice('Environment="NODE_OPTIONS='.length, -1);
  assert.equal(options, '--max-old-space-size=768 --import=/etc/roove-staging/network-guard.mjs');
  const guard = new URL('../deploy/staging/network-guard.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    await assert.rejects(fetch('https://hpsenndhoyzgnnkrhtly.supabase.co/rest/v1/'), /Staging blocks external integrations/);
  `], { env: { ...process.env, NODE_OPTIONS: options.replace('/etc/roove-staging/network-guard.mjs', guard),
    ROOVE_ENVIRONMENT: 'staging', NEXT_PUBLIC_SUPABASE_URL: 'https://staging-app.rti-hq.com/supabase' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
