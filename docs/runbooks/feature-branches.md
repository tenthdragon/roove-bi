# Feature separation, 18 October 2026

The combined staging source is retained unchanged at
`codex/archive-staging-20261018` (`56c16d16c8ef144684479958cc0df9d042c7f688`).
The `staging` branch remains frozen at that commit. No branch history was rewritten.

Both new branches start at the current main application plus the isolated-local
workflow commit `b03d6072907c66abf761b541bc9808703b41b39e`.

| Branch | Initial isolation commit | Scope |
| --- | --- | --- |
| `codex/growth-execution` | `01b6b36` | Growth P0/P0.1 routes, components, RPC/domain code, rich-text dependencies, permissions, metrics, tests and historical Growth migrations |
| `codex/shopee-development` | `7678719` | Shopee Details/OAuth/campaigns, restricted reviewer/admin/invite access, supporting background-runner authorization fixes, tests and historical Shopee migrations |

Growth excludes the new Shopee Details route, reviewer role and Shopee migrations.
Shopee excludes Growth routes, components, permission catalog and migrations.
Each retains the same 24 reviewed Meta/CEP files as production `da5d04f`.
Generic shell components needed by a feature are retained with that feature;
future merges must review overlaps in navigation/permissions/package scripts.

Main contains development tooling and workflow changes only. No unfinished
feature, new production migration or production app activation accompanies this
separation. Existing Shopee functionality in main remains intact.

Historical numbered SQL is preserved, not renumbered or applied. Growth 195/196
and Shopee 190–195 require target-history reconciliation before any production
release. Never replay the combined history or copy staging records into production.
All original source, including optional staging helpers and remaining shared
refactors, remains recoverable from the archive even when not needed by a feature.

Each feature branch passed local feature tests, Meta tests, typecheck, lint and
build after extraction. The full local snapshot was verified without seed/reset
or migration, and production remained on `da5d04f` while staging was suspended.
