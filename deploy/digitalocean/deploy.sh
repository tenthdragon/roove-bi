#!/usr/bin/env bash
# Run as root on the existing production Droplet, with a verified commit SHA.
set -Eeuo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Run as root'; exit 1; }
commit=${1:?Pass the release commit SHA}
[[ "$commit" =~ ^[0-9a-f]{7,40}$ ]] || { echo 'Invalid commit'; exit 1; }
base=/var/www/releases/roove-bi
old=$(readlink -f "$base/current")
release="$base/${commit:0:8}-$(date +%Y%m%d-%H%M%S)"
backup="/root/roove-sync-backup-$(date +%Y%m%d-%H%M%S)"
override=/etc/systemd/system/roove-bi-cron@sync-jobs-worker.service.d/override.conf
timers=(roove-bi-cron-meta-sync.timer roove-bi-cron-scalev-sync.timer roove-bi-cron-sync-jobs-worker.timer)
worker=roove-bi-cron@sync-jobs-worker.service

git clone --single-branch --branch main https://github.com/tenthdragon/roove-bi.git "$release"
git -C "$release" checkout --detach "$commit"
cp -p "$old/.env.local" "$release/.env.local"
chown -R roove:roove "$release"
cd "$release"
runuser -u roove -- npm ci --include=dev --no-audit --no-fund
runuser -u roove -- node --import tsx --test tests/sync-schedule.test.ts tests/meta-pagination.test.ts tests/scalev-sync-runner.test.ts tests/scalev-request-timeout.test.ts
runuser -u roove -- env NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2048 npm run build

mkdir -m 700 "$backup"
for timer in "${timers[@]}"; do
  cp -a "/etc/systemd/system/$timer" "$backup/$timer"
done
if [ -f "$override" ]; then cp -a "$override" "$backup/override.conf"; fi
rollback() {
  trap - ERR
  set +e
  echo 'Deploy failed; restoring previous release and schedules.'
  systemctl stop "${timers[@]}" "$worker"
  for timer in "${timers[@]}"; do cp -a "$backup/$timer" "/etc/systemd/system/$timer"; done
  if [ -f "$backup/override.conf" ]; then cp -a "$backup/override.conf" "$override"; else rm -f "$override"; fi
  ln -sfn "$old" "$base/current.rollback"
  mv -Tf "$base/current.rollback" "$base/current"
  systemctl daemon-reload
  systemctl restart roove-bi
  systemctl start "${timers[@]}"
  exit 1
}
trap rollback ERR
systemctl stop "${timers[@]}"
# Stop the prior CLI process so it does not keep executing old code. Interrupted
# jobs remain recorded and are recovered by the existing 30-minute stale lease.
systemctl stop "$worker"
ln -sfn "$old" "$base/previous"
ln -sfn "$release" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
systemctl restart roove-bi
healthy=0
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:3000/ -o /dev/null; then healthy=1; break; fi
  sleep 2
done
[ "$healthy" -eq 1 ]
for timer in "${timers[@]}"; do
  install -m 644 "$release/deploy/digitalocean/$timer" "/etc/systemd/system/$timer"
done
mkdir -p "$(dirname "$override")"
install -m 644 "$release/deploy/digitalocean/roove-bi-cron@sync-jobs-worker.service.d/override.conf" "$override"
systemctl daemon-reload
systemctl enable "${timers[@]}"
systemctl restart "${timers[@]}"
trap - ERR
systemctl start roove-bi-cron@meta-sync.service
systemctl start --no-block "$worker"
echo 'DEPLOY BERHASIL; worker verification is still required.'
readlink -f "$base/current"
systemctl list-timers --all --no-pager | grep roove
