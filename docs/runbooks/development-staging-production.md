# Local development and production releases

The default workflow is **local → review and CI → main → production release**.
There is no mandatory staging deployment. An environment runs a specific release
commit; it need not follow every documentation/tooling commit on `main`.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Reviewed, releasable code; the source for production releases |
| `codex/growth-execution` | Unfinished Growth P0/P0.1, isolated from Shopee enhancements |
| `codex/shopee-development` | Unfinished Shopee dashboard/reviewer/integration enhancements |
| `staging` | Frozen combined integration branch; no deployment trigger |
| `codex/archive-staging-20261018` | Preserved combined source at `56c16d16c8ef144684479958cc0df9d042c7f688` |

Start new feature branches from current `origin/main`. Keep unrelated work out
of the same branch. Work in separate worktrees when multiple agents are active.
Commit and push incomplete work to its feature branch; keep the PR as a draft
until it is ready. Bring current `main` into ongoing branches regularly.
Do not promote the combined archived staging branch into `main`.

Shared UI or authorization changes must be reviewed with the feature or extracted
into a separate prerequisite PR. Existing production Shopee functionality remains
in `main`; the Shopee branch contains the additional unfinished work.

## Local development

Both `npm run dev` and `npm run dev:local` use isolated Supabase. See [local-development.md](local-development.md).
It masks production dotenv keys and blocks external integrations. Do not run a
sync worker or forward production webhooks into the local snapshot.

The existing local clone and its feature overlays are preserved. A worktree
isolates files, not the local database. Start/maintain the stack from the primary
checkout. A feature worktree may explicitly link its ignored `.local` directory
to that existing state, after checking the path; it then shares the same database.
Only one app uses the default port 3130 at a time. Do not run bootstrap, reset,
clone activation, or concurrent feature migrations to switch branches. Truly
concurrent schema work needs separately provisioned database projects/ports.

## Release

1. Review the feature diff against current `main`, including dependencies and
   migrations. Run relevant tests, typecheck, lint and production build.
2. Merge only the approved feature into `main`; check CI for that commit.
3. On an authorized production deployment, build that exact commit with production
   public configuration. Prepare a separate release directory and source/build
   manifest. Preserve the running release for rollback.
4. Inspect actual production migration history. Apply only the new reviewed SQL
   in the intended order, before activating code that depends on it. Recovery
   preparation follows the change: function definitions/grants for function-only
   changes; an appropriate verified data backup for data-changing migrations.
   Do not perform a full database export for every UI release.
5. Activate and verify the running process directory, commit/build, authenticated
   workflows, permissions, report totals and workers. Restore the previous app
   release if activation verification fails. Record the app/database changes;
   an app rollback does not undo a migration.

Production data stays in production. Do not restore development/staging fixtures
or a staging dump into production. `main` may contain approved tooling changes
ahead of the deployed app; report both commit IDs accurately.

## Suspended staging

On 18 October 2026, `staging-app.rti-hq.com` was changed to an HTTPS 503 response.
The Next service and five isolated Supabase containers are stopped. The app and
cleanup timer are disabled; container restart policies are `no`.

Preserved on the DigitalOcean host:

- Docker volumes `roove-staging_db` and `roove-staging_storage`.
- `/var/www/releases/roove-bi-staging`, including current/previous release links.
- `/opt/roove-staging` backups/configuration and `/etc/roove-staging` credentials.
- Original nginx configuration and container inventory under
  `/opt/roove-staging/suspended-20261018`.

DNS and TLS remain configured. The suspension marker is
`/etc/roove-staging/SUSPENDED`. Disabling services releases their active memory;
retaining volumes, releases and backups does not free their disk space.
Automatic staging cleanup is disabled so retained data is not silently deleted.

Staging can be deliberately reactivated for external OAuth, Shopee reviewer
access, shared acceptance tests or host-specific validation. Reactivation is a
separate requested action: verify the retained database, choose the reviewed
feature release/migrations, start the existing containers/app, restore the saved
nginx config after `nginx -t`, then verify login/permissions/Storage and production
health. Do not initialize, reset or delete the retained volumes. Historical
staging helpers remain in the archive; their old branch rules are superseded here.
