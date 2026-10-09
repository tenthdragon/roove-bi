import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStagingRequest } from '../deploy/staging/network-guard.mjs';
import { readFileSync } from 'node:fs';
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
