import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GET } from '../app/api/environment/route';

test('environment endpoint reports the files of the running release and excludes manifest secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'roove-environment-'));
  const cwd = process.cwd();
  const original = { ...process.env };
  try {
    await mkdir(path.join(root, '.next'));
    await writeFile(path.join(root, '.release-source.json'), JSON.stringify({ commit: 'a'.repeat(40), credential: 'private' }));
    await writeFile(path.join(root, '.next/BUILD_ID'), 'actual-build\n');
    process.chdir(root);
    Object.assign(process.env, { ROOVE_ENVIRONMENT: 'staging', ROOVE_SOURCE_BRANCH: 'staging', ROOVE_RELEASE: 'aaaaaaaaaaaa-staging', ROOVE_SOURCE_COMMIT: 'b'.repeat(40) });
    const response = await GET();
    const body = await response.json();
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(body.commit, 'a'.repeat(40));
    assert.equal(body.buildId, 'actual-build');
    assert.equal(body.integrationsEnabled, false);
    assert.equal(body.release, 'aaaaaaaaaaaa-staging');
    assert.doesNotMatch(JSON.stringify(body), /private|credential/);
    await writeFile(path.join(root, '.release-source.json'), '{bad json');
    await rm(path.join(root, '.next/BUILD_ID'));
    const unavailable = await (await GET()).json();
    assert.equal(unavailable.commit, null);
    assert.equal(unavailable.buildId, null);
  } finally {
    process.chdir(cwd);
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    await rm(root, { recursive: true, force: true });
  }
});
