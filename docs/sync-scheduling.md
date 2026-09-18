# Scheduled sync

## Behavior

- ScaleV reconciliation starts at **02:00, 17:00 and 18:00 WIB**. Existing
  non-final orders, including `processing` and today's orders, are rechecked.
- Meta ad spend is queued **every ten minutes**, using **today in WIB only**.
  The old D-3 through D-1 automatic refresh is removed. Historical corrections
  are now picked up only if a user explicitly syncs those dates manually.
- Google Sheets imports retain their existing manual behavior.
- Active workspace connections determine the workspaces to enqueue. An active
  queued/running Meta job for the same date/workspace is deduplicated.
- Meta snapshot replacement is atomic per account/date range. Fetch/pagination
  failures preserve existing spend; queue failures use existing retry/backoff.
- Both HTTP and CLI workers enqueue follow-up ScaleV batches. Default batches
  contain at most 100 orders, fetched with concurrency five.

Order reconciliation cannot discover orders whose initial webhook never
inserted a database record. Missing terminal order lines use the separate
repair flow. A scheduled start does not guarantee completion at that minute;
monitor `sync_jobs`, `scalev_sync_log` and `meta_sync_log` for delays/errors.

## DigitalOcean Droplet deployment

Apply `supabase/migrations/194_atomic_meta_ads_refresh.sql` before deploying
this app. It adds a service-role-only function without modifying existing data.
Do not blindly replay old migrations: production migration history may differ
from the repository's legacy numbering.

Use the existing application checkout and service manager. Install dev
dependencies as well (`npm ci --include=dev`) because the CLI scripts use
`tsx`, then build and restart the app. The app environment must supply
`CRON_SECRET` and the existing Supabase/Meta credentials. Scripts load Next.js
`.env*` files from the checkout; keep secret files outside version control.
`SYNC_BASE_URL` defaults to `http://127.0.0.1:3000`; set it if the app uses a
different port.

On a server whose cron daemon uses UTC, install the following entries for the
app user, substituting the actual checkout and absolute Node binary. Preserve
unrelated entries and replace any existing Meta/ScaleV/worker schedules so only
one scheduler owns these jobs. Ensure the app user can write the lock/log paths.
Do not combine this worker cron with an existing continuously running worker.

```cron
# UTC 10:00/11:00/19:00 = WIB 17:00/18:00/02:00
0 10,11,19 * * * cd /path/to/roove-bi && /usr/bin/flock -n /tmp/roove-orders.lock /usr/bin/node --import tsx scripts/scheduled-sync.ts orders >> /path/to/logs/sync-orders.log 2>&1
*/10 * * * * cd /path/to/roove-bi && /usr/bin/flock -n /tmp/roove-ads.lock /usr/bin/node --import tsx scripts/scheduled-sync.ts ads >> /path/to/logs/sync-ads.log 2>&1
* * * * * cd /path/to/roove-bi && /usr/bin/flock -n /tmp/roove-worker.lock /usr/bin/node --import tsx scripts/sync-jobs-worker.ts --max-jobs=20 >> /path/to/logs/sync-worker.log 2>&1
```

`flock` prevents overlapping CLI worker invocations; each worker drains up to
20 jobs, including follow-up batches. Later ticks continue any backlog. Ensure
log rotation exists. A worker run can exceed one minute on a Droplet; unlike a
Vercel request it is not subject to the route's 60-second timeout.

After deployment, check app health, trigger `scheduled-sync.ts ads`, run the
worker once and inspect job/log results. Confirm the returned date range is
today WIB. Check installed cron entries and confirm they execute under the
correct user and timezone. Retain the previous app release for rollback; the
additive database function may remain installed if rolling back the app.

## Vercel compatibility

`vercel.json` contains the same enqueue schedules, with the HTTP worker every
two minutes (one job per tick). These apply only when hosted on Vercel. Do not
run Vercel and Droplet cron against the same production database simultaneously.

## Capacity

Ten-minute refresh means 144 scheduled runs/day. With A accounts and one page
per account, baseline Insights traffic is roughly 144*A requests/day, plus
pagination/token checks/retries. Actual capacity depends on account counts,
provider throttling and database timings. Monitor duration, queue age and
errors after enabling; no production load guarantee is implied.

## Existing production Droplet

Production at `app.rti-hq.com` runs as user `roove` under `roove-bi.service`.
The active release is `/var/www/releases/roove-bi/current`; keep `previous`
pointing to the prior release when switching. Preserve its `.env.local`.

This server already uses systemd timers rather than crontab. Install the three
versioned timer files from `deploy/digitalocean/` into `/etc/systemd/system/`,
and its worker override into the corresponding service drop-in directory.
The existing shared `roove-bi-cron@.service` and HTTP cron runner remain in use
for Meta and orders. Only the worker switches to the CLI to drain up to five
jobs per run. systemd does not start a second instance while that unit runs.
Reload systemd and restart/enable the three timers after the app is healthy.
Do not also install the example crontab above. Journald handles these job logs.
