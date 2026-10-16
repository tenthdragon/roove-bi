# Scheduled sync

## Behavior

- ScaleV reconciliation starts at **02:00, 17:00 and 18:00 WIB**. Existing
  non-final orders, including `processing` and today's orders, are rechecked.
- All Meta Ads syncs are queued **once daily at 17:00 WIB**: account spend,
  ad-level metrics/creatives, and inventory/mapping. No saved funnel is required;
  all active workspace Meta accounts participate. Spend failure does not block
  enqueueing ad details or mapping.
- Opening a page, reloading its status, restarting the app, and deploying a
  release do not enqueue Meta syncs. The Meta timer has no startup catch-up;
  if the server misses 17:00, the next scheduled/manual sync catches up from
  the persisted data checkpoint.
- Sync is incremental. Spend resumes from the last fully successful workspace
  log through today, re-reading at least yesterday to finalize prior intraday
  data. Ad-level metrics resume separately per account from its last successful
  coverage date through yesterday, including the boundary day for corrections.
  A first sync with no checkpoint reads yesterday (spend also includes today),
  rather than automatically backfilling 90 days. Failed/partial spend logs do
  not advance its checkpoint; failed ad snapshots do not write coverage.
- The Meta Ad Funnel **Sync** button uses the same incremental bundle and tracks
  spend, detail and mapping jobs. It ignores the displayed report date filter;
  existing 90-day reports remain readable without re-fetching 90 days.
- Google Sheets ads imports retain their **ten-minute** schedule via
  `/api/meta-sync?source=daily_ads` (`scheduled-sync.ts sheets`). This is a
  separate schedule so Sheets-only workspaces retain their existing behavior.
  Each feed uses its active workspace connections and refreshes the available
  Ads tab. Manual Sheets sync remains available.
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
0 10 * * * cd /path/to/roove-bi && /usr/bin/flock -n /tmp/roove-ads.lock /usr/bin/node --import tsx scripts/scheduled-sync.ts ads >> /path/to/logs/sync-ads.log 2>&1
*/10 * * * * cd /path/to/roove-bi && /usr/bin/flock -n /tmp/roove-sheets.lock /usr/bin/node --import tsx scripts/scheduled-sync.ts sheets >> /path/to/logs/sync-sheets.log 2>&1
* * * * * cd /path/to/roove-bi && /usr/bin/flock -n /tmp/roove-worker.lock /usr/bin/node --import tsx scripts/sync-jobs-worker.ts --max-jobs=20 >> /path/to/logs/sync-worker.log 2>&1
```

`flock` prevents overlapping CLI worker invocations; each worker drains up to
20 jobs, including follow-up batches. Later ticks continue any backlog. Ensure
log rotation exists. A worker run can exceed one minute on a Droplet; unlike a
Vercel request it is not subject to the route's 60-second timeout.

Deployment does not enqueue a Meta sync. After deployment, check app health,
inspect the installed timer and existing job/log results. Verify the next
17:00 WIB run, or explicitly request a manual sync when one is wanted.
For that run, confirm spend, ad detail and mapping jobs cover active Meta
accounts and their date ranges follow the persisted checkpoints.
Check installed cron entries and confirm they execute under the
correct user and timezone. Retain the previous app release for rollback; the
additive database function may remain installed if rolling back the app.

## Vercel compatibility

`vercel.json` contains the same enqueue schedules, with the HTTP worker every
two minutes (one job per tick). These apply only when hosted on Vercel. Do not
run Vercel and Droplet cron against the same production database simultaneously.

## Capacity

Meta runs once per day, plus explicit manual requests. Normal daily catch-up
reads only the boundary/new dates instead of 90 days. Mapping refreshes account
inventory and may enqueue bounded creative follow-ups. Actual capacity depends
on account counts, pagination and provider throttling. Monitor duration, queue
age and errors. Sheets retains 144 enqueue ticks/day.

## Existing production Droplet

Production at `app.rti-hq.com` runs as user `roove` under `roove-bi.service`.
The active release is `/var/www/releases/roove-bi/current`; keep `previous`
pointing to the prior release when switching. Preserve its `.env.local`.

This server already uses systemd timers rather than crontab. Install the four
versioned timer files from `deploy/digitalocean/` into `/etc/systemd/system/`,
the dedicated `roove-bi-cron-sheets-sync.service`, and its worker override into the corresponding service drop-in directory.
The existing shared `roove-bi-cron@.service` and HTTP cron runner remain in use
for Meta and orders. Only the worker switches to the CLI to drain up to five
jobs per run. systemd does not start a second instance while that unit runs.
Reload systemd and restart/enable the four timers after the app is healthy.
Do not also install the example crontab above. Journald handles these job logs.

### Applying this schedule change

Changing the repository timer does not change the running Droplet by itself.
Deploy the matching app/worker release and install all four timers plus the
Sheets service together; otherwise the old ten-minute timer still invokes Meta.
Do not start a second worker. Verify the effective Meta timer is 17:00 WIB,
the Sheets timer is every ten minutes, and the first Meta run enqueues spend,
ad-detail and mapping jobs even without saved funnels. Existing deployment
rollback restores previous timers and removes newly introduced timer files.
