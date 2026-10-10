# Roove BI development staging and production

Develop features locally, evaluate them at https://staging-app.rti-hq.com,
then release the reviewed code and database migrations to production. Each
environment has its own database. Test records never move to production.

## Environments

| Environment | Application | Database |
| --- | --- | --- |
| Development | http://127.0.0.1:3130 | Local Supabase snapshot; start with `npm run dev:local` |
| Staging | https://staging-app.rti-hq.com | Self-hosted staging Supabase on the existing server |
| Production | https://app.rti-hq.com | Existing hosted Supabase production project |

Staging runs independently of the laptop. Its app service, release directory,
Docker network, database volume, Storage volume and credentials are separate
from production. It shares server CPU, memory and disk with production; container
memory caps and app CPU/memory limits reduce contention but are not hardware
isolation. The initial dataset is the verified local production snapshot captured
on 9 October 2026 at 18:56 WIB, plus local Growth migration 195 and its workspace
feature flag. Existing email/password accounts are copied; staging sessions must
be established separately. A STAGING banner identifies the environment.

The staging API is under `/supabase` on the staging domain. Database ports are
not exposed publicly. Auth, REST and Storage are reached by nginx on fixed private bridge addresses.
No container ports are published.
Their Docker network has no external egress. Auth emails go to an internal mail
sink. Signups are disabled. No staging sync workers, cron jobs, Telegram sender
or Edge runtime are started. The app's preloaded network guard allows only the
staging API and dedicated local staging ports, and refuses a production API URL.
Production credentials are absent from the new staging app environment.

## Feature workflow

`main` contains code approved for production. `staging` is the permanent
integration branch and the only source for staging deployment. Create short-lived
feature branches from `staging`, merge reviewed changes back into `staging`,
and delete feature branches once their changes are retained there. Product
approval and an explicit release to `main` are required before production deployment.

1. Work on a feature branch such as `codex/growth-case-improvement`. Run the app
   against local Supabase and record new schema changes as reviewed SQL migrations.
2. Commit the intended feature changes, then run relevant tests, typecheck, lint
   and build. Merge into `staging` and push it to GitHub. Build the exact pushed
   `staging` commit from a Git archive with its own
   public Supabase URL and anon key; these values are embedded in browser assets.
   Changing runtime environment variables alone does not change that build.
3. Apply new migrations only to the staging database. Back it up first.
   Do not replay the legacy migration directory or bootstrap/reset the clone.
   On the host, `python3 deploy/staging/migrate.py <absolute-staging-migration-path>`
   backs up the fixed staging database and records a transactional checksum.
   It refuses migration versions through 195, which are already in the snapshot.
4. Prepare a distinct staging release, with its staging-only `.env.local`,
   dependencies and `.next` build. Set `ROOVE_SOURCE_BRANCH=staging` and
   `ROOVE_RELEASE=<first-12-commit-characters>-staging` in the release environment.
   Include `.release-source.json` containing `{"branch":"staging","commit":"<full-40-character-commit>"}`.
   The deployment helper verifies this commit against the current GitHub
   `staging` head before switching the release. On the host, run
   `bash deploy/staging/deploy.sh /var/www/releases/roove-bi-staging/<release>`.
   The script checks the endpoint and browser bundle, switches only the staging
   release, and rolls back that release if its environment health check fails.
5. Validate real login, permissions, workspace switching, numbers, persistence,
   image uploads and feature workflows at the staging domain. Record the tested
   commit/build and migration set. The app environment endpoint identifies the
   deployed branch, release and snapshot date: `/api/environment`.
6. After explicit product approval, release that exact code and migration set
   through the established production deployment process. Preserve production
   data. Never restore a staging dump or test records into production.

A code push is not production approval. The repository currently has a CI
workflow that checks branches; staging deployment is manual and a push alone
does not update the app. Production promotion remains deliberate.
Staging deployment helpers do not start production timers or modify production
service files, environment files or release links.

## Data and backups

Staging is a snapshot, not live replication. Production changes do not appear
until a deliberate refresh. Before refreshing, back up the staging database and
Storage, preserve feature records and migration overlays, restore the fresh
snapshot into a new database, apply overlays and verify before switching.
Automatic refresh is not implemented; `initialize.py` refuses an existing
staging database. Never rerun initialization to overwrite test work.

Private server configuration and backups are under `/opt/roove-staging` and
`/etc/roove-staging`; keep them out of Git. The database is `roove_staging` in
`roove-staging-db-1`. Use only that container/database for staging migrations.
For a manual backup on the host:

```sh
umask 077
docker exec roove-staging-db-1 sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U supabase_admin -d roove_staging -Fc' > /opt/roove-staging/backups/staging-$(date +%Y%m%d-%H%M%S).dump
```

The preserved previous staging release used production credentials and must not
be restored as a working staging environment. Roll back only to a release built
for the isolated staging API. Refreshing data, scheduled backups, automated
staging deployment and production promotion gates can be added separately.

## Verification

```sh
node --test tests/staging-isolation.test.mjs
npm run test:dashboard-components
npm run typecheck:app
npm run build
```

The staging smoke check must verify authenticated reads and a write/rollback in
staging, Auth session refresh, Storage upload/download/delete, app pages in both
workspaces, rejection of production network requests and production health.
Run `node deploy/staging/smoke.mjs <private-staging-env-file>` against only the
staging API. It uses an existing owner through a generated Auth verification
link (no email or password reset), restores the workspace preference and cleans
up the temporary Storage bucket and object. A successful build alone does not
verify a deployment.

Staging Storage uses the official v1.74.0 image. Both local and staging databases
have the additive `storage-compat.sql` overlay for ordinary uploads, because
the self-hosted API requires a bucket/path conflict index while the hosted
snapshot contains partial object-versioning indexes. Existing indexes are
preserved. Object versioning is not supported in these testing environments.
Staging does not run Realtime, Studio or Edge Functions.

The first isolated staging release used the working tree with a P0.1 plan.
Subsequent P0.1 releases are built from a Git commit archive with staging-only
configuration; the release name identifies that commit. Commit and push each
reviewed release before promoting it. Credentials, dumps and browser test
sessions stay in ignored/private directories.

## Preserve existing staging features

The integration branch `staging` includes both Growth P0.1 and the previous
`codex/shopee-staging` features. It was created from the combined Growth and
Shopee release, preserving its full commit history. Deploying a standalone feature
branch that predates the current staging features removes those features from
the application, even when their database rows and permissions still exist.
Merge the current staging feature set before preparing a release and validate
both a workspace owner and the existing Shopee reviewer accounts. Shopee
reviewers must retain only Shopee Details and Admin Shopee; Growth and other
workspace facts remain inaccessible to them.

Shopee schema migrations 189–195 are included as historical source from the
Shopee branch. They are already present in the verified snapshot and must not
be replayed on the local clone or staging. The imported legacy auto-deployment
job/script is excluded from this integration. The server's legacy
`/usr/local/sbin/deploy-roove-bi-staging` entrypoint is disabled so the old
Shopee branch cannot replace the combined release. Use the isolated workflow above.
