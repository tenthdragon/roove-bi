/* Run on the application server: credentials and row backups stay on that server.
 * First collect with --app-root <release> --backup-dir <private directory>.
 * After reviewing the summary, add --apply-cache <same directory> to patch only
 * the profile-visit field of existing daily facts. Never inserts or full-syncs.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const production = 'https://hpsenndhoyzgnnkrhtly.supabase.co';
function normalizeVisits(v) {
  if (!['string', 'number'].includes(typeof v) || String(v).trim() === '') return null;
  const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function chunks(from, to) {
  const result = []; let start = from;
  while (start <= to) {
    const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 30);
    const end = [d.toISOString().slice(0, 10), to].sort()[0]; result.push([start, end]);
    const next = new Date(end + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); start = next.toISOString().slice(0, 10);
  }
  return result;
}
async function fetchVisits(account, from, to, token, request = fetch) {
  let url = new URL('https://graph.facebook.com/v21.0/' + account + '/insights');
  for (const [k, v] of Object.entries({ fields: 'ad_id,adset_id,instagram_profile_visits', level: 'ad', time_increment: '1', limit: '500',
    time_range: JSON.stringify({ since: from, until: to }), use_unified_attribution_setting: 'true', action_report_time: 'impression' })) url.searchParams.set(k, v);
  const rows = new Map(), seen = new Set(), versions = new Set(); let calls = 0;
  while (url) {
    if (url.origin !== 'https://graph.facebook.com') throw Error('Invalid Meta pagination host');
    url.searchParams.delete('access_token');
    if (seen.has(url.href)) throw Error('Repeated Meta cursor'); seen.add(url.href);
    const response = await request(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(60000) }); calls++;
    const body = await response.json();
    if (!response.ok || body.error) throw Error('Meta API ' + (body.error?.code || response.status) + ': ' + String(body.error?.message || 'Request failed').split(token).join('[redacted]'));
    if (!Array.isArray(body.data)) throw Error('Invalid Meta response');
    const version = response.headers.get('facebook-api-version'); if (!/^v\d+\.\d+$/.test(version || '')) throw Error('Missing Meta API version'); versions.add(version);
    for (const r of body.data) {
      if (!/^\d+$/.test(r.ad_id) || !/^\d+$/.test(r.adset_id || '') || !/^\d{4}-\d\d-\d\d$/.test(r.date_start || '') || r.date_start < from || r.date_start > to || r.date_start !== r.date_stop) throw Error('Invalid Meta daily scope');
      const key = r.ad_id + ':' + r.date_start; if (rows.has(key)) throw Error('Duplicate Meta daily row');
      rows.set(key, { ad_id: r.ad_id, adset_id: r.adset_id, metric_date: r.date_start, instagram_profile_visits: normalizeVisits(r.instagram_profile_visits) });
    }
    if (calls > 1000) throw Error('Meta page limit exceeded');
    url = body.paging?.next ? new URL(body.paging.next) : null;
  }
  if (versions.size !== 1) throw Error('Meta API version changed during pagination');
  return { rows, calls, apiVersion: [...versions][0] };
}
function payloadForFacts(facts, returned) {
  return facts.map(f => {
    const r = returned.get(f.ad_id + ':' + f.metric_date);
    // No Meta row/field is unavailable, never an invented zero. A different
    // adset is passed through so the database rejects a changed identity.
    return { ad_id: f.ad_id, metric_date: f.metric_date, adset_id: r ? r.adset_id : f.raw_insights?.adset_id || null,
      instagram_profile_visits: r?.instagram_profile_visits ?? null };
  });
}
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function unchangedPart(row) {
  const copy = structuredClone(row); delete copy.metrics.instagram_profile_visits;
  delete copy.raw_insights.instagram_profile_visits; delete copy.raw_insights.ig_profile_visit_observation;
  return stable(copy);
}
async function main() {
  const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
  const root = fs.realpathSync(arg('--app-root') || process.cwd()), req = createRequire(root + '/package.json');
  for (const line of fs.readFileSync(root + '/.env.local', 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || /^\s*#/.test(line)) continue; const i = line.indexOf('=');
    process.env[line.slice(0, i).trim()] ||= line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, production);
  req('tsx/cjs'); const { resolveWorkspaceCredential } = req(root + '/lib/workspace-integration-server.ts');
  const db = req('@supabase/supabase-js').createClient(production, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const applyDir = arg('--apply-cache'), dir = applyDir || arg('--backup-dir');
  if (!dir || !path.isAbsolute(dir)) throw Error('Absolute private server backup directory required');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
  const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value), { mode: 0o600 });
  const check = result => { if (result.error) throw Error(result.error.message); return result.data; };
  const readFacts = async a => {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const data = check(await db.from('meta_ad_daily_metrics').select('*').eq('workspace_id', a.workspace_id).eq('account_id', a.account_id).order('metric_date').order('ad_id').range(offset, offset + 999));
      rows.push(...data); if (data.length < 1000) return rows;
    }
  };
  if (applyDir) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); assert.equal(manifest.project, production);
    const results = [];
    for (const item of manifest.accounts) {
      if (item.error || !item.file) { results.push(item); continue; }
      const cached = JSON.parse(fs.readFileSync(path.join(dir, item.file), 'utf8')); const a = cached.account;
      assert.equal(a.workspace_id, item.workspace_id); assert.equal(a.account_id, item.account_id);
      const current = await readFacts(a), before = new Map(current.map(r => [r.ad_id + ':' + r.metric_date, unchangedPart(r)]));
      save(item.file + '.before-apply.json', current); let saved = 0, skipped = 0;
      for (const batch of cached.batches) for (let i = 0; i < batch.payload.length; i += 500) {
        const result = check(await db.rpc('save_meta_instagram_profile_visits', { p_workspace_id: a.workspace_id, p_account_id: a.account_id,
          p_rows: batch.payload.slice(i, i + 500), p_observed_at: batch.observedAt, p_api_version: batch.apiVersion }));
        saved += result.saved; skipped += result.newer + result.missing + result.scope_changed;
      }
      const after = await readFacts(a); let changed = 0;
      for (const r of after) if (before.get(r.ad_id + ':' + r.metric_date) !== unchangedPart(r)) changed++;
      if (changed || after.length !== current.length) throw Error('Concurrent/non-profile fact change detected; investigate server backup before continuing');
      const scoped = new Set(cached.batches.flatMap(b => b.payload.map(r => r.ad_id + ':' + r.metric_date)));
      const rows = after.filter(r => scoped.has(r.ad_id + ':' + r.metric_date));
      const known = rows.filter(r => r.metrics.instagram_profile_visits != null);
      const summary = { workspace_id: a.workspace_id, account_id: a.account_id, saved, skipped, rows: rows.length,
        known: known.length, not_returned: rows.length - known.length, visits: known.reduce((n, r) => n + r.metrics.instagram_profile_visits, 0), other_fields_preserved: true };
      results.push(summary); console.log(JSON.stringify(summary)); save('apply-results.json', results);
    }
    return;
  }
  const accounts = check(await db.from('meta_ad_accounts').select('workspace_id,account_id,account_name,is_active').order('workspace_id').order('account_id'));
  const manifest = { project: production, at: new Date().toISOString(), accounts: [] }; save('manifest.json', manifest);
  for (const a of accounts) {
    const item = { workspace_id: a.workspace_id, account_id: a.account_id, account_name: a.account_name };
    try {
      const facts = await readFacts(a); if (!facts.length) { item.rows = 0; manifest.accounts.push(item); save('manifest.json', manifest); continue; }
      const file = a.workspace_id + '_' + a.account_id + '.json'; save(file + '.before.json', facts);
      const token = await resolveWorkspaceCredential({ supabase: db, workspaceId: a.workspace_id, provider: 'meta', fallbackEnvKeys: ['META_ACCESS_TOKEN'] });
      const batches = []; let calls = 0, known = 0, absent = 0;
      for (const [from, to] of chunks(facts[0].metric_date, facts.at(-1).metric_date)) {
        const observedAt = new Date().toISOString(); const fetched = await fetchVisits(a.account_id, from, to, token); calls += fetched.calls;
        const scoped = facts.filter(f => f.metric_date >= from && f.metric_date <= to), payload = payloadForFacts(scoped, fetched.rows);
        known += payload.filter(r => r.instagram_profile_visits !== null).length; absent += payload.filter(r => r.instagram_profile_visits === null).length;
        batches.push({ from, to, observedAt, apiVersion: fetched.apiVersion, payload });
        console.log(JSON.stringify({ phase: 'collected', account_id: a.account_id, from, to, rows: scoped.length, api_calls: fetched.calls }));
      }
      save(file, { account: a, batches }); Object.assign(item, { file, rows: facts.length, ads: new Set(facts.map(r => r.ad_id)).size, from: facts[0].metric_date, to: facts.at(-1).metric_date, known, not_returned: absent, calls });
    } catch (e) { item.error = String(e.message).replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 700); }
    manifest.accounts.push(item); save('manifest.json', manifest); console.log(JSON.stringify(item));
  }
  console.log(JSON.stringify({ phase: 'collection_complete', accounts: manifest.accounts.length, failures: manifest.accounts.filter(a => a.error).length, rows: manifest.accounts.reduce((n, a) => n + (a.rows || 0), 0), database_writes: 0 }));
}
module.exports = { normalizeVisits, chunks, fetchVisits, payloadForFacts, unchangedPart };
if (require.main === module) main().catch(e => { console.error(String(e.message).replace(/https?:\/\/[^\s]+/g, '[url]')); process.exitCode = 1; });
