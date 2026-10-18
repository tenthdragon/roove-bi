# Shopee development branch

Branch: `codex/shopee-development`, based on the reviewed main/local-workflow baseline.
Source: the combined staging snapshot `56c16d16c8ef144684479958cc0df9d042c7f688`,
preserved at `codex/archive-staging-20261018`.

This branch retains Shopee Details, OAuth/API/campaign work, the restricted reviewer
role, invite/admin changes, and the server authorization/background-runner separation
needed to keep reviewer access scoped. Existing production Meta/CEP code is retained.
Growth routes, components, permissions and Growth migrations are excluded.
Generic dashboard shell components are dependencies of this branch.

This is unfinished development work, not an approved production release. Use isolated
local Supabase via `npm run dev:local`; external integrations remain blocked locally.
Run `npm run test:shopee`, `npm run test:meta-funnels`, typecheck, lint and build.
A future external reviewer or OAuth acceptance test may need deliberately reactivating
a public isolated preview. The suspended staging app is not automatically restarted.

Historical Shopee migration files 190–195 are retained unchanged for provenance and
local fixtures. They may already exist in local/staging snapshots while production
history differs. Inspect actual target schema/history before release; do not bulk
replay these files, rename applied files, or restore staging test records. Prepare
new forward migrations for the target production state if needed. The archived
Growth migration also used 195, so a future combined integration must reconcile IDs.

The original combined branch and retained server volumes preserve all prior data
and source. Any future merge with Growth must review shared dashboard/permission
changes instead of copying this branch over the other feature.
