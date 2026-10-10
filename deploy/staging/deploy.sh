#!/usr/bin/env bash
# Run on staging host with an already-built, reviewed release directory.
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
release=${1:?Pass a prepared release directory}
[[ "$release" =~ ^/var/www/releases/roove-bi-staging/[a-zA-Z0-9-]+$ ]] || { echo 'Invalid staging release'; exit 1; }
[ -d "$release/.next" ] && [ -f "$release/.env.local" ]
python3 - "$release" <<'PY'
import json,pathlib,re,subprocess,sys
release=pathlib.Path(sys.argv[1])
env=dict(line.split('=',1) for line in (release/'.env.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
source=json.loads((release/'.release-source.json').read_text())
assert source.get('branch') == 'staging', 'Refusing release from a non-staging branch'
commit=source.get('commit', '')
assert re.fullmatch(r'[0-9a-f]{40}',commit), 'Invalid source commit'
remote=subprocess.check_output(['git','ls-remote','--heads','https://github.com/tenthdragon/roove-bi.git','refs/heads/staging'],text=True,timeout=30).strip().split()
assert len(remote) == 2 and remote[0] == commit and remote[1] == 'refs/heads/staging', 'Release is not the current GitHub staging commit'
expected='https://staging-app.rti-hq.com/supabase'
assert env.get('NEXT_PUBLIC_SUPABASE_URL') == expected, 'Refusing non-staging database'
assert env.get('NEXT_PUBLIC_APP_ENV') == 'staging'
assert env.get('ROOVE_ENVIRONMENT') == 'staging'
assert env.get('ROOVE_SOURCE_BRANCH') == 'staging', 'Missing staging source branch'
assert env.get('ROOVE_RELEASE', '').startswith(commit[:12]+'-'), 'Release identifier does not match source commit'
for folder in ['.next/static','.next/server']:
 for p in (release/folder).rglob('*.js'):
  assert b'hpsenndhoyzgnnkrhtly.supabase.co' not in p.read_bytes(), 'Production database in build'
assert any(expected.encode() in p.read_bytes() for p in (release/'.next/static').rglob('*.js')), 'Staging API missing from browser build'
PY
curl -fsS --max-time 10 https://staging-app.rti-hq.com/supabase/auth/v1/health >/dev/null
base=/var/www/releases/roove-bi-staging
old=$(readlink -f "$base/current")
rollback() {
  trap - ERR
  if [ -f "$old/.env.local" ] && grep -q '^NEXT_PUBLIC_SUPABASE_URL=https://staging-app.rti-hq.com/supabase$' "$old/.env.local"; then
    ln -sfn "$old" "$base/current.rollback"
    mv -Tf "$base/current.rollback" "$base/current"
    systemctl restart roove-bi-staging
  else
    systemctl stop roove-bi-staging
    echo 'Previous release uses production; staging stopped for repair.'
  fi
  echo 'Staging release rolled back; production was not changed.'
  exit 1
}
trap rollback ERR
chown -R roove:roove "$release"
ln -sfn "$old" "$base/previous"
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl restart roove-bi-staging
healthy=0
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 5 http://127.0.0.1:3001/api/environment | python3 -c 'import sys,json; result=json.load(sys.stdin); assert result["environment"]=="staging" and result["branch"]=="staging"'; then healthy=1; break; fi
  sleep 2
done
[ "$healthy" -eq 1 ]
trap - ERR
echo 'Staging release active. Validate authenticated workflows before production approval.'
