# Advertiser brand access

Workspace owners allocate one or more brands from **Admin → Users → Brand yang
dapat diakses → Simpan alokasi brand** under each active advertiser. Allocations
are independent for every workspace membership. An advertiser with no allocation
sees an instruction to contact the workspace owner and receives no Meta data.

Meta accounts follow their existing `default_brand_id` assignment. Advertisers
see only accounts attached to their allocated brands; accounts without a brand
are excluded. The restriction covers Ringkasan Brand, Detail Brand, Pemetaan Ads,
history, creatives, categories, totals and filter options. Direct requests for an
unallocated brand/account are rejected. The database report RPCs remain accessible
only through server actions with verified membership and brand scope.

Global template settings, historical notifications and global sync-job metadata
are hidden from advertisers because those records can span multiple brands.
Existing read access for other roles remains unchanged. Advertisers cannot modify
global Meta configuration, even if their role is accidentally given `admin:meta`.

Every server request verifies current allocations before reading cached results.
Browser cache keys include user, workspace, permissions, assigned brands and Meta
accounts. The browser rechecks allocation on focus and every 30 seconds while the
page is open. A changed allocation discards the previous displayed scope. Data
already received by a user cannot be retroactively withdrawn from their browser.

Changing or suspending a membership clears its brand allocations. Assignments
and their removal are recorded in `workspace_advertiser_brand_audit`.

## Release dependency

Deploy only after an explicit production request. Apply reviewed migration
**224_advertiser_brand_access.sql** after the existing Meta migrations through
223, before activating this application version. It creates membership grants,
audit records, owner-only allocation RPC, invalidation triggers, and an additional
scoped overview RPC. Existing unrestricted RPCs and report projections are retained.

No advertiser receives a default allocation during migration. Owners must assign
brands to existing advertisers after release; until then those users see no Meta
brand data. The migration makes no changes to advertising facts or existing
membership roles. An application rollback to the old code also restores its old
workspace-wide advertiser behavior; retaining the new table alone does not enforce
brand filtering in an older application.

## Validation

- `npm run test:advertiser`: server boundaries, cache separation and browser
  allocation revalidation.
- `npm run test:access-requests-db`: migration 221 and 224 authorization/lifecycle
  checks in a disposable database, also run by CI.
- `npm run test:advertiser-brand-report-db`: incremental report parity and real
  revision triggers using the fixed local clone; migrations and fixtures roll back.
- Existing Meta suite, `npm run typecheck:app`, `npm run lint`, `npm run build`.
