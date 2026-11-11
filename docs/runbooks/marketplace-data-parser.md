# Marketplace Data Parser

The sidebar is **MP Data Parser**; the page title is **Marketplace Data Parser**.
Configuration is shared by the workspace and versioned with compare-and-swap
saves. There is no session-only routing override.

## Configure the workspace

1. Add each source account with its Marketplace and exactly one connected
   Business. For example, the agreed Roove workspace setup is Shopee Roove →
   RTI and Shopee Pluve → JHN. These are configuration data, not code defaults.
2. Select the Stores used within those Businesses. Choose a connected Warehouse
   once per Store. Names and IDs come from the application's master data.
   Warehouse CSV labels come from configured marketplace integration data;
   an absent or ambiguous label blocks export rather than adding a guessed suffix.
3. Load the cached bundle catalogs of the accounts' receiving Businesses. Include
   every bundle available to that Business, owned or shared, regardless of Store
   membership or price options. A full Business sync must have completed successfully.
   Running, failed, unknown or changing generations block export for that Business.
4. Products, SKU classification, Product routes and combination priorities remain
   optional advanced rules. They never rewrite SKU identity or become prerequisites
   for catalog-based or approved routing. Do not seed historical guesses as rules.
5. Maintain Marketplace courier/service mappings and save the team configuration.

## Exact bundle identity and Store routing

Every source SKU must equal exactly one identifier in the receiving Business,
including case and whitespace. No aliases, trimming, fuzzy matching or name fallback.
Owned and shared bundles qualify; Store installation and Scalev price options do not
control eligibility. Incomplete Business snapshots or duplicate codes block export.

Resolve one Store for the entire order in this order:

1. The latest approved account + Business + exact bundle-case decision.
2. Compatible single-bundle decisions and a unique common Store from available
   cached bundle–Store relationships, restricted to configured active Stores.
3. Existing saved Product/combination rules, if unambiguous.
4. Otherwise offer Store suggestions and require explicit **Gunakan & simpan**.
   Name overlap only ranks suggestions; it never changes bundle identity or silently
   chooses a destination. A sole configured Store alone is not evidence.

Bonus markers (`free`, `bonus`, `gratis`, `gift`) in bundle/source descriptions
conservatively require first approval before catalog or Product rules can route.
This includes uncertain bonus cases; do not assume the bonus Product is dominant.
An approved exact case bypasses that first-review requirement. Single-bundle keys
ignore purchased quantity; multi-bundle keys aggregate identical bundle lines and
include quantities, so a different composition requires another decision. Mixed
order decisions do not overwrite single-bundle decisions. Account and Business are
always part of the decision scope. Invalid locked Stores require review.

Approvals append a revision with actor/time and originating batch/order. The unique
case-hash/revision constraint rejects concurrent writes. Replacing a decision is
explicit, applies to matching future cases and leaves prior revisions intact.
Warehouse follows global Store configuration; unresolved Warehouse blocks export.

## Upload, validate, download and archive

Select account and date, then upload the original XLSX (maximum 10 MB). The server
checks workspace access, reads the file, and stores original bytes in the private
`marketplace-parser-archive` bucket before showing preview. Batch metadata contains
the account/Business snapshot, source hash, parsed source, uploader, time and date.
Source Marketplace must match the chosen account. Successful batches are archived;
invalid file formats are rejected before registration.

All source fields are read-only: SKU, quantity, price, buyer username, tracking
receipt and original courier. Only application mappings may change. The main order
row shows username, resi, source courier and mapped Scalev courier. Inline Store
search lists at most six Stores, never the bundle universe. **Detail** exposes raw
source fields and validation without edit inputs.

Missing or duplicate bundle codes show inline Scalev links. A verified foreign
bundle retains explicit Business sharing; unknown/incomplete snapshots direct the
operator to sync instead of claiming a bundle must be created. Diagnosis reads only
the application's database; Scalev is called only by explicit sync/sharing actions.

The whole batch must pass. The server accepts only an archived batch ID, config
revision and catalog fingerprint for export, reprojects source data and checks
context again before archiving output. Every export creates a new CSV and JSON
snapshot with config, routing decisions, source hash, catalog version and calculations.
No original or previous export is overwritten. File downloads check workspace scope,
object path and SHA-256 integrity. Tables allow the service role SELECT/INSERT only;
RLS and a restrictive Storage policy prevent direct anonymous/authenticated access.

**Riwayat batch** opens original files, reopens saved source with current rules, and
lists every CSV/snapshot. Reopening does not alter old output. Changing a batch's
account Business requires a new upload; its old archive stays accessible. The parser
does not create Scalev orders or upload the CSV to Scalev.

## Migration and operation

This branch contains `20261107220000_marketplace_parser_route_business.sql`
and `20261109220000_marketplace_parser_account_stores.sql`. Inspect migration
history and apply only pending files in that order. The latter migration:
permits schema version 3, retains old revisions/history, adds service-only
per-Store sync status, and adds an available-link lookup index. Apply only the pending
reviewed migrations before activating the feature; do not replay history.

Version 1/2 configurations are converted to a **draft**, never silently saved.
Legacy generic accounts are expanded by Marketplace and require review. Conflicting
Business or Store assignments stay incomplete. Exact existing master-data names
resolve to IDs. Legacy SKU substitutions and name rules are removed; the original
marketplace code must now exist in Scalev. Team save activates the reviewed draft.
An application rollback does not reverse a saved v3 config: restore the previous
config through a new audited revision if an old app release must be used.

The parser now uses full Business catalog synchronization. Store membership tables
provide routing evidence only; absence of membership never invalidates a bundle. Business sync and parser sharing share a compare-and-
swap lease in `scalev_catalog_sync_state`; lost/expired generations cannot mark success.
Before a post-sharing sync, release the sharing claim into a non-ready state, then
acquire a new sync claim. Competing syncs fail safely and never unlock partial data.
Local diagnosis can use a copied snapshot; live Scalev changes remain disabled locally.
Never copy local fixtures or database dumps back to production.

The archive/routing update adds
`20261111074823_marketplace_parser_archive_routing.sql`. Review and apply only this
pending migration before activating the feature. It adds immutable batch/export
metadata, versioned routing decisions and the private Storage bucket. No production
bundle, Store or existing team configuration is changed. App rollback leaves these
additive tables/files intact; never copy local synthetic archives into production.
Backup/restore planning must include both database metadata and Storage objects.
There is no automatic archive deletion or retention expiry in this update.
At release, verify the reverse proxy accepts at least 11 MB request bodies for
`/api/marketplace-parser/archive` (10 MB file plus multipart overhead). The handler
enforces its own streaming limit; do not depend on the Server Actions body limit.

## Validation

### Database diagnosis and explicit Scalev repair

**Periksa masalah** and **Muat ulang data aplikasi** use indexed, exact `custom_id`
lookups, scoped to active Businesses in the current workspace. No credentials, API
calls, Store links or BPOs are needed. Completed snapshots do not expire based on age.
Missing data means not recorded in the app, not confirmed absent in Scalev.
A confirmed receiving-Business match remains valid if an unrelated Business is syncing.
Cross-Business searches require complete snapshots before authorizing sharing.

Ownership uses verified `scalev_owner_uid` matched to `scalev_business_uid`. Never
trust inferred legacy owner Business fields. A shared bundle already available in
the target is valid even if owner metadata or price options are missing.

- **Sinkronkan Business dari Scalev** explicitly refreshes the receiving Business's
  full catalog. Full sync still preserves owner/price metadata for other consumers;
  parser eligibility never uses those price options.
- If a unique bundle exists only in another connected Business, **Bagikan ke Business**
  verifies owner and receiver identities, exact bundle ID/code and existing sharing,
  then calls `POST /v3/bundles/{id}/partners` with the receiver's `partner_unique_id`
  using the owner's credential. It never calls the Store/BPO attachment endpoint.
- Sharing retries check availability/partners first. POSTs are not automatically
  replayed. Partial results preserve completed sharing and unresolved visibility.
- After sharing, a full receiving-Business sync reconciles identifiers and duplicates.
  The entire batch is reprojected, including filtered orders, and confirmation clears.
- Store approval is an application routing decision, independent of sharing. It
  never installs a bundle in a Store and never selects a Scalev price.

Diagnosis requires parser access and the Channels module. Sharing and full Business
sync additionally require catalog tab access plus `whs:mapping` (or platform owner).
Local development blocks live sync/mutations. Credentials remain server-side. The
v2 signed permit is actor/workspace-bound, expires after ten minutes and binds config
revision, account, target Business and exact sharing candidates. Old attachment/price
requests and old permits are rejected. Request/outcome audits use `warehouse_activity_log`.

### Shared API request budget and rollout

The previous release introduced `20261110120000_parser_cached_diagnosis.sql`.
Check that it is already applied; do not replay it. It adds nullable owner/BPO metadata, an exact identifier
index and a service-only API budget table/RPC. It does not rewrite old catalog
rows, team configuration, or external Scalev data. An old app remains compatible
with this additive migration. Missing RPC/schema fails closed for live requests.

The parser, normal catalog sync and order-sync API adapter reserve PostgreSQL
slots per SHA-256 credential hash, shared across processes and workspaces using
the same key. Starts are spaced 250 ms apart. HTTP 429 or exhausted quota records
provider `Retry-After` (seconds/date), falling back to `X-Ratelimit-Reset` epoch.
Queued calls recheck cooldown and reserve a new spaced slot if needed. Waits over
20 seconds return a retry time rather than sleeping through an hourly reset.
No raw API key, customer payload, or upstream error body is stored in this table.
Calls from outside these adapters/other apps are not coordinated by this budget.

Existing successful full Business snapshots can be reused. If a Business has no
completed full snapshot, explicitly sync that Business. Missing price metadata does
not block download; missing verified owner identity only prevents sharing.
This update adds new archive tables/bucket on deployment. No existing business data
is rewritten. Code rollback preserves the additive schema and archives but restores
the previous parser workflow.

### Checks

- `npm run test:marketplace-parser`: domain, interaction, server access/export,
  catalog scope, warehouse labels, Scalev pagination, exact database diagnosis with zero Scalev calls,
  Business-only sharing retry, signed action scope, management access, partial
  failures, exact routing approvals/replay/conflicts, bonus cases, immutable source,
  archive integrity/workspace scope, and whole-batch revalidation regressions.
- `node tests/marketplace-parser-config-database.mjs`: isolated PostgreSQL checks
  for config history/CAS, v1/v2/v3 compatibility, sync-state constraints, RLS, shared
  request budget, append-only archive grants and concurrent decision revisions.
- `npm run typecheck:app`, `npm run lint`, `npm run build`.
- Browser acceptance: synthetic XLSX orders against the real local catalog,
  automatic RTI/JHN destinations, two bundle lines in a mixed order, blocked
  unknown SKU, Store search/approval/reopen, source/CSV archive, global save/reload,
  and desktop/mobile layout. Local development blocks live Scalev changes.
