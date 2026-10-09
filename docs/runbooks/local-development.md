# Roove BI — isolated local Supabase

This workflow runs the real Roove BI application, Auth, PostgreSQL, Storage,
REST API and Studio on this computer. After a completed clone is verified and
activated, the database is a private, unsanitized logical snapshot of production,
with additional feature migrations applied only locally. Until activation, the
existing fixture database stays active. This does not provision a cloud project, push migrations,
change production data, or overwrite `.env.local`.

## Production snapshot mode

The clone exports one repeatable-read snapshot, including all application and
Auth tables, password hashes, indexes, functions, policies and grants. Large
tables use primary-key-ordered HTTPS read-only queries of at most 1,000 rows.
Primary keys are selected before loading/serializing payloads, avoiding wasted
JSON processing on skipped rows. PostgreSQL's existing pgcrypto extension
compresses/encrypts the canonical CSV before transfer, using a transient random
packet key. The helper decodes it locally, checks its source SHA-256 and saves a
private gzip CSV package. No source extensions or functions are installed.
Four requests run concurrently. A read-only PostgreSQL
transaction holds the snapshot, which is imported/re-exported every minute
without changing data visibility. Session timeouts are explicitly set because
the pooler does not propagate client PGOPTIONS. Failed requests retry only that
package. A shared request-start limiter stays below 120 requests/minute; response
headers provide a cooldown when needed. A throttled request never resets saved
packages. Every successful package has an atomic manifest checkpoint and a
separate private recovery sidecar. On a later run, expired snapshots are never
reused: saved packages are compared with the fresh source snapshot by CSV
SHA-256, and unchanged packages are retained without downloading the rows again.
During an active export, `--continue-active <private-archive-directory>` first
imports the still-live snapshot and verifies matching catalog/count metadata.
Only after the new keeper confirms handover may the old export be stopped. The
new process can retain its completed packages without even re-querying source
data. If the snapshot is no longer live, handover fails safely; run normally to
verify saved packages against a fresh snapshot instead.
Archive checksums, all source table counts
and name-based schema fingerprints are checked before activation. Every restored
package's canonical CSV content SHA-256 is also matched to its source checksum,
using four local read-only workers. Activation refuses incomplete verification.

Restoration first creates a separate local database. The previous local
database is retained as `roove_before_clone_<timestamp>`, in addition to private
backups in `.local/backups/`. No destructive automatic reset is performed.
Each COPY and its local restore checkpoint commit in the same transaction.
Pre/post-data schema phases also commit with their checkpoint atomically. A
failed restore resumes completed packages rather than inserting duplicates or
recreating the database. The private `roove_local_clone` checkpoint schema is a
local-only addition, not production business data.
Snapshot files, manifests and credentials are in Git-ignored `.local/` (0700);
data files and passwords are private (0600). Never commit or upload them.

Login uses the existing Roove BI email/password accounts from the snapshot,
not the old dummy `@roove.test` accounts. Local API/JWT credentials, endpoints,
Auth redirects, email delivery and Docker role passwords remain local. Existing
production sessions are not transferable; log in again locally. Changes made
locally do not flow back to production, and later production changes do not
automatically appear in this snapshot.

Storage bucket/object metadata is included. The captured production database
has no Storage objects, so no separate Storage file download is needed.
Materialized views are refreshed locally from the restored snapshot tables;
this is a logical database clone, not a physical server image. Server-managed
Vault encryption keys and cloud Auth/provider/SMTP settings are not database
rows and are not exported. Integration execution is deliberately blocked locally.

The local launcher preloads `scripts/local-network-guard.mjs`, which blocks
external fetch/HTTP(S) calls from the Next process, while retaining integration
configuration rows unchanged. Production dotenv credentials are blanked before
Next starts. No sync worker, cloud cron, production webhook forwarding or Edge
runtime is started. Ordinary `npm run dev` retains the existing production
dotenv behavior: use **`npm run dev:local`** for this environment.

After activation, `db:local:setup` starts and verifies the clone without running
historical migrations or dummy seeds. `db:local:migrate` and `db:local:seed`
refuse to alter an active clone. Apply one deliberately reviewed, new feature
migration locally instead:

```sh
npm run db:local:migration -- 195_growth_execution.sql
```

Checksums prevent silent replacement of an already-applied migration. Feature
overlays are recorded in `.local/clone-state.json` and private local history.
Migration 195 and enabling Growth in the local Roove workspace are overlays,
not part of the production parity baseline. No dummy BI, brands, users or
business tasks are inserted into the cloned database.

The clone helpers (`local-clone-http.mjs`, `local-clone-restore.mjs`,
`local-clone-activate.mjs`) target a fixed production project for **reads only**
and the fixed `supabase_db_roove-bi-local` container for all writes. Export
requires the database password in `.local/production-db.env`; neither the
service-role API key nor Management API token replaces PostgreSQL credentials.
Do not reset the production password for cloning. Replacing an active clone
requires a deliberate backup/review workflow; activation refuses to silently
overwrite an existing clone.

Run export, restore and activation in sequence, only proceeding when each
command succeeds. Export automatically discovers saved packages in the private
archive directories. Restore requires a completed export; activation requires
verified table counts and schema fingerprints. Stop the local Next process
before activation, then restart it with `dev:local` afterwards.

```sh
npm run db:local:backup
node scripts/local-clone-http.mjs
node scripts/local-clone-restore.mjs
node scripts/local-clone-activate.mjs
```

After restarting the local app, `node scripts/local-clone-smoke.mjs` verifies an
existing owner through local Auth, authenticated RLS reads, both workspace
switches, and real dashboard/Growth routes. It sends no email, resets no
passwords, creates no users, and restores the owner's original local workspace
preference after testing.

## First setup (empty, fixture-only database)

Requirements: Node.js 20+, installed npm dependencies, Supabase CLI 2.75.0,
and a running Docker-compatible runtime. Ports 54320–54324 and 3130 must be free.

```sh
npm run db:local:setup
npm run dev:local
```

The first setup downloads Docker images. Application: <http://127.0.0.1:3130>.
Studio: <http://127.0.0.1:54323>. API: <http://127.0.0.1:54321>.
PostgreSQL: `127.0.0.1:54322`. Local test emails: <http://127.0.0.1:54324>.
The helper creates its own `roove-bi-local-loopback` Docker bridge. While starting,
a private temporary Unix-socket proxy explicitly sets `HostIp=127.0.0.1` on
container-create requests labelled `roove-bi-local`, then the helper verifies
actual bindings. This is needed because CLI 2.75 omits HostIp and Docker Desktop
may ignore the bridge default. The proxy closes when start finishes; it does not
change the Docker daemon or other projects' network settings. Remote Docker
hosts are intentionally unsupported by this local-only workflow.

Before a production clone is activated, fixture login emails are `owner@roove.test`, `growth@roove.test`, `creative@roove.test`
and `reviewer@roove.test`. Their generated local-only password is in
`.local/login.json` (mode 0600, Git-ignored). Do not reuse it elsewhere.

The real workspace switcher can switch between **Roove Workspace · Lokal**
(Growth enabled) and **Apurva Workspace · Lokal** (Growth disabled). The Growth
portfolio and three initial records are labelled dummy local examples. BI is
not populated with fake revenue or copied production reports. Integrations are
disabled and the launcher blanks dotenv values before overriding Supabase keys.
Next may still list `.env.local` in its startup output; its declared values are
masked in the child environment, not used as production credentials.
Do not use ordinary `npm run dev` when intending to work on the local database:
that command retains its existing `.env.local` behavior.

## Daily use

```sh
npm run db:local:start
npm run dev:local
```

Stop Next with Ctrl+C. Then `npm run db:local:stop` stops only the
`roove-bi-local` stack and preserves its volumes/data. It does not stop other
Docker projects. Restarting uses the same data and credentials; no destroy is
required and no additional Supabase cloud compute is used.

Use `npm run db:local:status` for safe URLs and `npm run db:local:verify` to
check local Auth/REST health and the saved clone verification. Before cloning,
verification checks fixture logins and Growth RLS instead. `db:local:setup`
preserves an activated clone; only an empty fixture installation uses bootstrap
migrations and seed data.
The helper intentionally has no remote push/link/reset/delete operation.

`npm run db:local:backup` creates a PostgreSQL custom-format backup of the
current local database in `.local/backups/` (private, Git-ignored), without
overwriting a previous backup. Use it before replacing local data with a
production snapshot. A complete production clone requires SQL database access;
the application service-role key and Management API token are not a substitute
for a PostgreSQL password. Do not reset a production password just to clone.

## Why a local bootstrap adapter exists (fixture mode only)

The historical migration directory was maintained for SQL Editor deployment,
not clean Supabase CLI replay. It has duplicate version prefixes, diagnostics,
missing pre-migration tables/roles, an early vendor alteration, and production
stock/order cutovers with exact historical-row assertions.

Canonical files under `supabase/migrations/` remain untouched. The helper:

- Copies a separate config and deterministically ordered SQL into
  `.local/supabase/`, with a distinct `roove-bi-local` project/container identity.
- Uses `supabase/local/legacy-base.sql` for missing tables. Column types were
  checked through a read-only catalog query; this is not a full production clone.
- Includes legacy/later enum values in the local initial schema, omits diagnostic
  and rollback files, and moves vendor PKP after vendor creation. Reconstructs
  the pre-026 customer views; refreshes only existing MVs in 005; recreates the
  monthly cohort wrapper in 050 for its intended column-type change. Indexes are
  built normally (not concurrently) inside the local checkpoint transaction.
- Keeps the product reference catalog but omits historical opening stocks from
  066/073, the 038 production CSV repair, and the 096 bank account number seed.
  Adds inactive dummy business references needed by warehouse foreign keys.
- Omits migration 174's production-only stock cutover. Migration 179 retains its
  routing schema/grants/trigger without transferring 40 production orders.
- Applies each adapted file and its checksum checkpoint atomically to the fixed
  local Docker database, recording history in private `roove_local` tables.
- Refuses to silently replay a changed already-applied file. It never resets an
  existing database automatically. New pending migrations use the same helper.

Generated SQL versions/checkpoints are **not production migration history**.
Do not link `.local` to a hosted project or use it for deployment. Use the
project's established production migration process after staging review.

If a legacy migration changes, review its local adapter and test a separate
fresh local stack deliberately; do not delete existing local data casually.
Local acceptance checks do not prove production-data parity, third-party
integration behavior, or production load/performance.

## Staging and production promotion

Use `docs/runbooks/development-staging-production.md` for the server staging
workflow. `staging-app.rti-hq.com` now uses its own server-side database snapshot,
independently of this laptop. Development and staging both have the additive
`deploy/staging/storage-compat.sql` overlay for ordinary file uploads; object
versioning is not supported in these non-production environments. Never apply
that overlay to hosted production.
