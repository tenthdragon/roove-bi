# Staging suspended

The staging app and isolated Supabase services were suspended on 18 October 2026
without deleting data. Normal work follows local → CI/review → main → production.
See `docs/runbooks/development-staging-production.md` for retained volumes,
configuration and deliberate reactivation.

Historical implementation is preserved at `codex/archive-staging-20261018` and
the frozen `staging` branch. Do not rerun its initialize/reset scripts against
the existing database. The public staging domain returns HTTP 503.
