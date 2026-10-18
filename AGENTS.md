# Development and releases

The normal workflow is local development → review/CI → `main` → an explicitly
requested production release. Read `docs/runbooks/development-staging-production.md`.

- Start unrelated work on a separate feature branch from current `origin/main`.
  Use a separate worktree when another agent is working concurrently. Preserve
  user changes and other agents' worktrees. Never force-push their branches.
- Unfinished Growth and Shopee enhancements live on `codex/growth-execution` and
  `codex/shopee-development`. Do not merge the archived combined staging branch
  wholesale into `main`. Shared dependencies must be reviewed explicitly.
- Use `npm run dev:local` for development. Plain `npm run dev` may read production
  dotenv settings. Local Supabase is a separate database; code branches/worktrees
  do not isolate a shared database. Coordinate schema writes and never reset an
  existing snapshot to switch features.
- Keep `.local/`, credentials, database copies and test sessions out of Git.
  Do not copy local/staging test records or database dumps into production.
- Run relevant tests, `npm run typecheck:app`, `npm run lint`, and `npm run build`
  before promoting code. Record the exact release commit and migrations.
- Production deployment needs a user request or existing authorization covering
  that deployment. A feature-branch push is not deployment authorization.
- Apply only deliberately reviewed new migrations. Do not replay the historical
  migration directory or rename an already-applied migration. The archived
  Growth/Shopee migration number collisions require reconciliation before release.
- Staging was suspended on 18 October 2026. `staging` and
  `codex/archive-staging-20261018` preserve the combined source. Its database,
  Storage, releases and backups are retained. Do not reactivate or delete them
  unless requested; staging is optional for external integration/reviewer tests.
