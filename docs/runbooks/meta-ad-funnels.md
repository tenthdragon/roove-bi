# Meta Ads: brand-first ad quality reporting

Available in Marketing Channel → Meta Ads (`/dashboard/meta-funnels`). Every
Meta Ads page shares one sub-navigation: Ringkasan brand, Pemetaan Ads,
Notifikasi, Template funnel, Kategori iklan.

## Advertiser access (migration 220)

The `advertiser` role is available in Admin Users (invite, approval and role
changes) and the workspace permission matrix. Its initial permission is only
`tab:meta-funnels`: login opens Meta Ads directly. Marketing Channel remains a
sidebar group, without access to its main report or any other dashboard page.
Meta Ads reports, mappings, categories, templates and notifications are readable;
editing, sync and integration configuration still require `admin:meta`.

Apply only `220_advertiser_role.sql` before inviting a new advertiser. It adds
the compatibility profile enum and seeds the global role template plus every
existing workspace. `provision_workspace` copies the global role template for
future workspaces, including `advertiser` → `tab:meta-funnels`.
Existing `tab:marketing` users retain their Meta Ads access. Both workspace
modules (`marketing` and `meta-funnels`) must remain enabled for Meta Ads.

## Pages

- **Ringkasan brand** (`/dashboard/meta-funnels`): one row per brand with
  spend split by world (Website = Non-CPAS ads, CPAS = Shopee ads), the shared
  ad-response CTR, the Website CPP/CPL, the CPAS CPP/ROAS, a health dot and the
  top automatic highlights. Sync status and the manual **Sync** button live here.
- **Detail brand** (`/dashboard/meta-funnels/brand/<brandId>?world=website|cpas`):
  a Website / CPAS segmented control, ranked **Sorotan** (highlights), the
  shared **Respon iklan** layer (CPM, CTR outbound, hook rate, LPV ratio or
  purchase per click), then **Hasil**. On Website, results are grouped per
  funnel template with that template's own columns; landing pages without a
  template appear in a "Belum ditetapkan" block with automatic suggestions.
  On CPAS, results are per ad with CPP and ROAS from Meta attribution. Clicking
  a row opens a drawer with stage ratios, a 14-day trend of the template's main
  cost metric, and the ads behind the row. The "catatan data" drawer collects
  coverage gaps, unread URLs (with the verified-URL form), unread objectives and
  unassigned landing pages.
- **Template funnel** (`/dashboard/meta-funnels/templates`): the former
  "Funnel baru" form is now the template editor, and its stages and metrics are
  used by the report again. The page also holds URL matching (landing pages
  with spend in the last 30 days, evidence, suggestion, template select) and
  the rule list. Presets create a Transaksi or Lead template.
- **Pemetaan Ads** (`/dashboard/meta-funnels/mapping`): a worklist of the ads
  that delivered in the selected date range, ranked by spend. See
  "Pemetaan Ads worklist" below.
- Legacy `?view=alerts` and `?view=mapping` links still redirect.

Ringkasan brand, Detail brand and Pemetaan Ads show the global completed-days
date picker; Template funnel and Notifikasi have their own context.

## Active-ad scope (migration 217)

Every report read (`get_meta_ad_report`) only counts ads with at least one
impression inside the requested date range. Ads paused long ago, ads whose
rows only carry zero-delivery coverage and ads that only exist in the mapping
inventory no longer appear in brand totals, facet counts, CEP rows or the
"Belum ditetapkan" blocks. Spend without impressions on the same day (rare
Meta corrections) still counts as long as the ad delivered somewhere in the
range. The comparison period and 90-day history retain the same ad cohort that
delivered inside the selected range.

Migration 217 also adds `get_meta_ad_activity(workspace, from, to, account)`
(service role only): per-ad spend, impressions and last delivery date for ads
with impressions in a range of at most 92 days. Pemetaan Ads and the mapping
worker use it. Until the migration is installed both fall back to the whole
inventory and the page shows a notice.

`tests/meta-ad-report-db.sql` contains a paused fixture ad with impressions
only before the fixture range; `npm run test:meta-report-db` checks that the
SQL output and the TypeScript reference rules both exclude it.

## Funnel templates and URL rules

A saved `meta_ad_funnels` row with `group_by = landing_page` is a template. Its
kind is derived, never stored: stages or metrics using purchases mean
Transaksi, leads/conversations/replies mean Lead, otherwise Lainnya. Its main
cost metric is spend ÷ purchases (CPP) or spend ÷ leads (CPL), falling back to
spend ÷ last stage.

`meta_landing_page_templates` (migration 211) assigns landing pages by rule:
`exact` (canonical URL), `prefix` (canonical URL prefix) or `domain`
(hostname, subdomains included). Precedence is exact > prefix > domain, then the
longest pattern. A landing page with several URLs or no readable URL is never
assigned. Suggestions come from events in the period (purchase > 0 and
lead = 0 → Transaksi; lead > 0 and purchase = 0 → Lead) and are only applied
when an admin confirms. Archiving a template deletes its rules. Rule writes bump
the report revision so cached reports invalidate.

URL assignment saves update the matching rows, rule list, and template counts
without reloading the performance report. The selected value appears immediately
with a pending label; a failed save restores the previous assignment. Expected
read/write failures return a safe message rather than a production render digest.
Template edits reload only configuration, not spend or event totals. Row order
stays stable while assigning URLs.

Decline notifications are evaluated by the sync worker, not inside template-save
requests. Incremental sync evaluates complete cached windows even when attribution
lag puts the alert window before the newly refreshed day. Missing coverage still
blocks evaluation. A template that has at least
one URL rule only monitors landing pages matched to it; a template without
rules keeps monitoring every landing page in its account scope.

## Highlights

`lib/meta-ad-highlights.ts` ranks five pure rules by severity, then spend:
stage leak (a consecutive-stage ratio down ≥ 15% with ≥ 30 events in both
periods), cost outlier (main cost ≥ 1.5× the template median, ≥ 3 landing
pages), hidden winner (≤ 0.8× median with spend at or below the median),
weak response (CTR or hook rate down ≥ 15% brand-wide, or a landing page below
half the brand CTR with ≥ 10% of spend) and data notes (coverage gaps, unread
URLs, unassigned landing pages). Brand health is bad if any bad highlight
exists, warn for warnings, else good.

Marketing access permits reporting and per-user notification acknowledgments;
`admin:meta` additionally permits template, rule, verified-URL and manual sync
writes. All server reads and writes use the authenticated user's active
workspace. Reporting tables and the snapshot RPC have no browser grants.

## CEP × intention view (migration 216)

Detail brand's **Hasil** section has a view switch: **Tujuan** (per template /
per ad, as before) and **CEP**. The CEP view reads the same scoped ads cut by
CEP × intention through a new report grouping, `p_group_by = 'cep_intention'`
(migration 216). Group keys are `cep:<cep>:<intention>`, with `__unknown__`
for a missing tag, so unmapped spend stays visible as its own row and column.
Within each key part, `%` and `:` are escaped as `%25` and `%3A`; free-form
tags remain distinct and decode back to the original filter value in drawers.
CTWA destinations are not resolved in this mode; the cell is the unit.

The view shows a matrix (rows = CEP, columns = intention in discovery →
consideration → conversion order, unmapped last) and one row per CEP. The CEP
lens judges **ad response**: CPM, CTR outbound, hook rate and LPV ratio
(purchase per click on CPAS), with the world's result cost (CPP where purchases
dominate, else CPL or cost per conversation when only WhatsApp results are recorded;
always CPP on CPAS) as the shared end point. Funnel
progression ratios (ATC, IC, purchase ratio) stay in the Tujuan view, where
they belong to the destination. Every matrix cell shows one selectable response
metric (default CTR outbound) above the result cost; cell and row colours
compare against the median of mapped CEPs in that column or metric, never the
brand total, with the signed log ratio capped at 2× either way. Clicking a CEP
opens a drawer with its 90-day weekly trend, the destinations carrying it
(Website only, with progression ratios matching the recorded result) and its top
ads, read through the existing `cep` filter.

A costly CEP is attributed before it is reported: its CTR outbound against the
CEP median says whether the ad is the cause, and its progress after the click
(purchases ÷ LPV, leads ÷ LPV for lead worlds, conversations ÷ outbound for
conversation results, purchases ÷ outbound on CPAS)
against the CEP median says whether the destination is. Either gap of 15% or
more names the observed gap: response, funnel, both, or neither. Attribution
stays undetermined if either side lacks a positive benchmark or enough
observations; missing funnel data must never be described as normal.

Highlights gain CEP rules: a costly CEP (≥ 15% of spend and result cost ≥ 1.5×
the CEP median, ≥ 3 mapped CEPs, with the diagnosis above in its text), a promising CEP (CTR ≥ 1.25× median with
spend share at or below the median and cost not above median), a CEP whose CTR
fell ≥ 20% with ≥ 10% of spend, and a data note when ≥ 20% of spend has no CEP
tag. Ringkasan brand shows a spend-share bar per CEP under each brand name,
read across the same Website and CPAS channels as its spend total. Ads whose
channel still needs verification do not dilute these shares.

Validate migration 216 on a local clone with report migrations through 215 using
`npm run test:meta-report-db -- --with-cep-migration`; migration 216 and fixtures
run in the same transaction and roll back. Tests compare CEP groups, dimension
filters, unknown tags, multiple accounts and focused history against the domain
rules with `group_by = 'cep_intention'`. If 216 is already installed locally,
the ordinary `npm run test:meta-report-db` also works. Before activating a new
staging release, apply 216 to its database using the staging backup/migration
procedure; a Git push alone does not migrate or deploy staging.

## Enable in production

1. Apply `198_meta_ad_funnels.sql`, `199_meta_ad_landing_pages.sql`, and
   `200_meta_verified_ad_destinations.sql`, `201_meta_ad_mappings.sql`, and
   `202_meta_ad_campaign_dimensions.sql` and `203_meta_ad_report_performance.sql` using the
   normal migration process, plus `211_meta_landing_page_templates.sql` for URL
   rules. Without 211 the pages still work; rule writes report the missing
   migration and every landing page stays "belum ditetapkan".

2. Deploy the app and sync-job worker together. The worker must understand
   `meta_sync` jobs with `ad_funnels_only: true` before processing them.
   Mapping jobs additionally use `ad_mapping_only: true`.
3. Confirm an active Meta integration and connected ad accounts in Admin Meta.
4. Create a Transaksi and, if used, a Lead template on Template funnel, then
   assign landing pages (a domain rule covers a whole website at once).
5. Use **Sync 90 hari** to initialize metrics and destinations. Jobs fetch one
   account and at most seven days each, newest weeks first. Follow progress in
   **Status sync histori**.

After successful scheduled account-spend sync, the existing scheduler queues
the most recent seven days of ad data for accounts used by saved landing-page
monitoring configurations. A coverage record for yesterday refreshed today
prevents repeated backfills on every ten-minute tick. Keep the worker running
and scheduled Meta sync enabled; no additional scheduler is required.

## Report loading and cache

### Incremental brand overview (migration 222)

Ringkasan brand uses one `get_meta_brand_overview_report` RPC for all brands,
both worlds, CEP spend and dimension choices. Migration 223 extends the same
projection to detail/history reads, as described below.
The new RPC preserves active-ad scope, current brand taxonomy (including
overlapping CEP memberships), historical objectives, CTWA identity, distinct-ad
counts and unavailable metrics. Ratios still come from event sums. Global
dimension choices retain the existing Website channel scope.

`meta_brand_report_days` stores service-only enriched daily ad projections.
`meta_brand_report_epochs` certifies each account/day against metric, account
metadata and workspace-brand revisions. Metric inserts/updates/deletes advance
only affected day revisions, including the old scope when a row moves. Creative,
mapping, verified URL, destination metadata or account writes advance that
account's metadata revision; brand writes advance the workspace revision. Source
writes and revisions commit together. Inventory timestamps, creative copy and
no-op updates do not invalidate projections; taxonomy-only edits resolve live.
Failed writes invalidate nothing. A
delayed older refresh cannot overwrite a newer projection certificate.

Only stale/missing projected dates in the requested and comparison periods are
rebuilt. Deleted dates become empty projections. Taxonomy resolves once per ad
delivering in the selected range, so fallback naming still uses that range's
latest fact; taxonomy, coverage and template assignments remain live rather than
being frozen into projections. Cache rows never replace source facts. Future
changes to projection semantics must invalidate these derived rows explicitly.

The existing five-minute server cache and shared RPC concurrency limit wrap the
batch. The page also has a bounded five-minute memory cache keyed by authenticated
user, permissions, workspace, dates and filters, with pending-request deduplication.
Status checks wait for an initial revision, bypass the navigation cache when it
changes, and leave unrelated cached date/filter selections to be checked on their
next visit. Manual reload bypasses the navigation cache. Meta's initial default
range does not wait for the unrelated sales-data extent.

Apply only reviewed migration `222_meta_brand_overview_incremental.sql` before
activating this app version, after verifying the active-ad/taxonomy prerequisites
from 217–219 are already present. No source-data backfill is required. First use
builds the derived dates; subsequent reads reuse them. App rollback can retain
these additive tables/triggers. Do not reset the local snapshot to test this.

Validation (the database runner installs 222 and fixtures in one rollback-only
transaction on the fixed local database):

```sh
npm run test:meta-overview
npm run test:meta-overview-db
npm run test:meta-overview-db -- --benchmark
npm run test:meta-funnels
npm run typecheck:app
npm run lint
npm run build
```

On the reduced local sample (2,206 Meta fact rows, five active-account brands),
the existing 21 calls took 2,449 ms of **serial database time**; the batch took
215 ms cold and 113 ms with its daily projections populated. These are local
query measurements, not production page-load times or a concurrent-load test.

Migration 203 provides a service-role-only aggregate RPC. Performa reads only
the selected dates plus an equally long comparison period. Brand, account,
name, CEP, intention and objective filters, distinct-ad facet counts and event
sums run in PostgreSQL. Ratios use event sums, preserving the existing formulas.
Daily comparison and the 90-day weekly/monthly history load only when their
tab/period is opened. Creative bodies load when creative details are opened.

The Next.js cache is keyed by workspace, canonical report parameters and the
workspace's database revision, with a five-minute fallback TTL. Statement
triggers change the revision in the same transaction as facts, coverage,
creative, mapping, verified URL, account and brand writes. CLI worker syncs
therefore invalidate results without Next.js-specific calls. Failed transactions
do not change the revision; successful zero-delivery syncs do. Authorization is
checked before every cached read. Job polling reads only status and revision;
it reloads performance when the revision changes.

Run `npm run test:meta-report-db` on the isolated local clone after migration 203.
The fixture transaction rolls back and compares SQL output with the existing
reporting rules, including facet counts, historical objectives, URL precedence,
manual mapping overrides, partial coverage, cache revision and workspace scope.

## Brand-owned CEP and intention (migration 218)

`218_meta_brand_taxonomy.sql` supersedes open-vocabulary classification in reports.
The raw provider name, parsed bracket terms and observation history remain intact.

- `meta_ad_cep_catalog` owns the official CEP definitions by workspace/brand. Only
  brands named Roove are seeded with Kulit (`skin`), Sendi (`joint`), Tulang
  (`bone`), Rambut (`hair`), and Kuku (`nail`). Other brands start without CEPs;
  admins create their definitions in **Kategori iklan**. Their keys include the
  brand ID so global filtering cannot merge unrelated brand categories.
- Intention is fixed to Discovery (`disc`), Consideration (`cons`), and Conversion
  (`conv`). Unknown is a review state, never an additional intention or CEP category.
- An ad may have several CEPs and one intention. Inline checkboxes and bulk edits
  save `overrides.ceps`; legacy valid `overrides.cep` remains readable. Manual
  selections (including an explicit empty CEP list) survive inventory refreshes.
- Resolution is manual selection, then an approved brand/dimension naming rule,
  then an exact recognized catalog/naming alias, then unmapped. Arbitrary bracket
  terms stay raw evidence and never create report categories. There is no
  semantic guess that `sport`, for example, means Sendi or Tulang.
- **Kategori iklan** previews matched ads, protected manual selections, example
  names and spend grouped by currency for the selected dates before saving a
  rule. Rules are persistent and apply to existing and future inventory, including
  paused ads. Choosing **Gunakan aturan** removes that dimension's manual value.
- `meta_ad_classifications` resolves the current inventory without overwriting
  provider names or historical performance rows. `meta_ad_taxonomy_audit` records
  definition, rule and manual-classification changes. Optimistic revisions reject
  stale saves. Catalog/rule writes invalidate the report revision.

CEP reports are overlapping cohorts, not an attribution model. An ad spending
100 with Skin and Joint contributes 100 to each CEP, but 100 once to the brand,
world, intention total, daily/trend summary, and distinct-ad counts. Group rows
and CEP participation percentages may sum above the unique brand total/100%.
The overview shows independent participation labels rather than a stacked share
bar; the matrix explains the overlap. Selecting one CEP keeps each matching ad
once and focuses CEP group rows on that selection. Focused history/creatives
honor any of the ad's CEP memberships. Costs/ratios derive from event sums.

Reports use the current classification, including for past reporting dates.
Remapping changes historical cohort membership, not recorded spend or outcomes.
Cross-workspace and cross-brand keys are rejected on writes. New definitions,
views and helpers are service-only; every Server Action checks workspace module
and dashboard permissions, with `admin:meta` required for changes.

Validation on the isolated sample:

```sh
npm run db:local:verify
npm run test:meta-taxonomy-db
npm run test:meta-report-db -- --with-taxonomy-migration
npm run test:meta-funnels
npm run typecheck:app
npm run lint
npm run build
```

The taxonomy database test uses an enclosing transaction and rolls back both
migration and fixture while 218 is absent. After installing that exact reviewed
file using `npm run db:local:migration -- 218_meta_brand_taxonomy.sql`, run the
report parity test without `--with-taxonomy-migration`; never reapply historical
migrations. Apply 218 and then 219 before releasing this app. Keep production raw metrics and
manual overrides; do not copy sample fixtures. On app rollback, 217's older report
function/grants can be restored deliberately, while retaining the new catalog,
rules and audit data. An app rollback alone does not undo 218's report semantics.
Production migration/release requires its own authorization.

## Automatic granular ad mapping

Migration 212 stores structured contact identity in
`meta_ad_destination_metadata.metadata.contact_identity`: Page ID, all observed
Page ID sources, international WhatsApp numbers and their source fields. No Page
name permission or Page access token is needed for these ad-level fields. Names,
creative copy and prefilled WhatsApp message text are not retained as identity.
The normal destination-sync batch collects these fields automatically. Missing
country codes are never guessed, and `phone_number_id` is never treated as a
phone number. Current nonempty phone observations replace older numbers.

An older/opaque metadata refresh preserves the stored identity only for the same
workspace, account, ad, creative and adset. A changed Page cannot inherit the old
Page's phone. This protection runs in the database, including for older deployed
workers. A missing number remains missing unless that same ad/version previously
returned one. Page/phone storage does not itself change brand assignment or URL
grouping; those still require a separate reporting change.

Use `scripts/ops/backfill-meta-ad-contact-identities.ts` with an explicit workspace,
environment file, expected API hostname and `--apply` to backfill existing WhatsApp
destinations. It reads Meta in batches of at most 50 ads and patches contact fields
through the service-only RPC with row locks and creative/adset checks. It never
updates URLs, CPAS evidence, historical facts, brand mappings or template rules,
and does not enqueue sync jobs. Optional backup/observation files contain business
contact data: keep them private on the server. Summary output contains counts and
missing ad IDs, not phone numbers. Run `npm run test:meta-contact-identity-db` on
the isolated local clone after migration 212.

The mapping inventory is keyed by workspace, account and ad ID. Ad names are
descriptive and mutable; two ads with the same name remain separate identities.
The inventory itself is independent of the report's date range and of whether
the ad has spent or delivered; the **Pemetaan Ads** page only narrows what it
shows (see "Pemetaan Ads worklist").

### Flexible CEP catalog (migration 219)

**Meta Ads → Kategori iklan** lets admins add, rename, define, deactivate and
reactivate CEPs for every brand, including Roove. The original five Roove CEPs
are initial definitions rather than a permanent limit. New keys are generated
from the name with a brand prefix; a rename preserves the stable key. Duplicate
names within a brand are rejected. Intention remains fixed to three choices.

Deactivation retires a choice from new manual assignments and new rules, without
deleting its catalog row, manual mappings, approved naming rules or report
memberships. Existing naming recognition and approved rules continue to resolve,
including future matching inventory; the confirmation lists affected rules and
explains that rules must be edited to stop automatic matching. Existing inactive
memberships may be retained or removed while repairing another dimension. They
cannot be added to a different ad or rule until reactivated. Historical report
filters retain the category. Hard deletes and changes to identity are blocked.

Catalog edits/status changes require `admin:meta`, reject stale revisions, record
before/after audit values and invalidate report revisions. An inactive category
can be renamed without reactivating it. All writes remain workspace/brand scoped.

Install only the reviewed new migration:

```sh
npm run db:local:migration -- 219_meta_cep_catalog_lifecycle.sql
npm run test:meta-taxonomy-db
npm run test:meta-report-db
```

The taxonomy test can apply missing 218/219 inside its rollback transaction. If
a migration is already installed, its checksum must match. Migration 218 is
unchanged after local installation. Deployments must apply both 218 then 219
before this app release; no production migration is implied by local preview.

## Pemetaan Ads worklist

The page answers one question: which ads that are spending money right now
can the brand report not read? `lib/meta-ad-worklist.ts` holds the rules;
`getMetaAdWorklist` in `lib/meta-ad-mapping-actions.ts` loads the inputs.

- Scope: ads with impressions in the global date range (via
  `get_meta_ad_activity`), ranked by spend. "Tampilkan juga ad tanpa impresi"
  appends the rest of the inventory. Without migration 217 the whole inventory
  is shown and the toggle is disabled.
- Four issue tiles count ads and spend in scope: CEP belum terpetakan,
  Intention belum terpetakan, Tujuan belum terbaca, Jenis iklan perlu
  verifikasi. Clicking a tile filters the table (`?issue=`); a green card
  appears when nothing is left. Deep links also accept `?account=`,
  `?channel=` and `?q=`.
- "Tujuan" is satisfied by Meta URLs, destination metadata URLs, a verified
  URL for the same creative, a WhatsApp destination or a CPAS ad; only ads
  with none of these are flagged.
- CEP and intention are edited inline with selects: "Otomatis" restores the
  value parsed from the ad name, only official brand CEPs and the three intentions are offered. CEP supports multiple selections; arbitrary text stays in the evidence drawer. Saves use the per-ad revision.
- Checkboxes plus the sticky bulk bar set or clear one label on up to 300 ads
  (`saveMetaAdMappingOverridesBulk`, one RPC per ad with a fresh revision;
  partial failures are reported per ad).
- Since migration 218, **Kategori iklan** maintains persistent brand-specific
  aliases with a preview. Earlier unit-to-manual mappings remain compatible;
  their valid manual selections are preserved. Raw units continue to be recorded
  as evidence and do not enter report filters or label pickers.
- The row drawer shows the parsed brackets, keywords, review notes, the
  destination evidence and channel reason, the verified-URL form (needs a
  creative ID) and the mapping revision history.

After each successful scheduled Meta account sync, accounts without an inventory
refresh today receive one mapping job each. No saved funnel is required. The
worker reads the `/ads` edge with full pagination before saving any mappings.
Creative destinations are refreshed in follow-up jobs with at most 100 ads
(two Meta batch requests) each. This avoids Meta's response-size limits and a
single large account exceeding the HTTP worker's 60-second execution window.
Inventory mapping completes before these jobs run; URLs can fill in afterward.
Missing creative data preserves mapping and previously cached metadata.
Creative follow-ups are only queued for ads that delivered in the last 30 days
(`get_meta_ad_activity`) or whose effective status is still `ACTIVE`; other
ads keep their cached metadata and are counted as `metadata_ads_deferred` in
the job summary. Without migration 217 every ad is treated as recent.
**Sync pemetaan** can request another refresh sooner. This is polling, not an
instant webhook. Ads omitted by Meta are retained rather than marked deleted.

After a manual mapping sync, the page tracks every returned job ID and its
creative/catalog descendants through the existing job-tree RPC. It polls every
15 seconds until all batches finish, then shows **Sync selesai**. Failed,
partial, canceled, and warning-bearing batches show **Sync selesai dengan
kendala** with their account/stage details; an unreadable status stays retryable
and never reports success. This tracking is scoped to the current viewer session
and workspace while the page is open. The recent ten-job preview is not used to
determine the result of the manual request. Global job details remain hidden from
brand-scoped advertisers. This UI change requires no new migration.

- `meta_ad_mappings`: current raw name, creative identity, status, URLs, parsed
  data, parser version and separate manual overrides.
- `meta_ad_mapping_observations`: distinct observed naming/creative/URL versions.
  Observation time is when the app read metadata, not proof of the historical
  delivery name or destination. Daily facts retain their own reported names.
- `meta_ad_mapping_units`: open vocabulary scoped by workspace and dimension.
  New values are registered immediately, with review state separate from parsing.
- `meta_ad_mapping_members`: per-ad bracket/keyword/manual memberships suitable
  for subsequent filtering and tabulation. Manual memberships take precedence
  for their dimension; automatic memberships retain the original evidence.
- `meta_ad_mapping_sync_state`: last complete inventory refresh per account.

Every well-formed bracket is captured with its exact text and ordinal position.
The first two leading adjacent brackets use CEP/intention as in the supplied
guide; later brackets remain `bracket_N` without guessing their semantic meaning.
Explicit translations normalize kulit/sendi/tulang/rambut/kuku to the existing
skin/joint/bone/hair/nail keys, and discovery/consideration/conversion to
disc/cons/conv. New terms remain independent units. Compound strings such as
`lupa+rawat+sendi` are not split or discarded. Case, surrounding whitespace and
Unicode composition are normalized; raw tokens and original names remain intact.

Text outside brackets is stored along with distinct lexical keywords. Keywords
are searchable evidence, not automatic semantic CEP/intention assignments.
Malformed/empty brackets produce review notes while keeping parseable tokens.
Bracket-unit review does not merge units or alter any ad name in Meta.

Admins can correct CEP/intention per ad. Corrections and unit review state
survive automatic refreshes; blank manual fields restore automatic values.
Optimistic revisions reject stale edits, and older sync/cache observations cannot
overwrite a more recent directly observed inventory. All mapping tables/RPCs
use the same server authorization, workspace scope and browser restrictions as
reporting. Existing verified URL fallbacks also appear in mapping when creative
identity matches. URLs are never inferred from naming tags.

Mapping/review and combined CEP/objective/intention filters are available.
Performance can group the selected ads by ad ID or landing-page URL. General
pivot tabulation and custom business-funnel classification are subsequent work.

## Brand filtering

The Brand filter uses each active ad account's brand mapping in Admin Meta.
It applies to the summary, ad/landing-page tables, daily comparisons, trends,
and coverage checks. Brand choices count distinct ads in the selected period
and other filters; missing mappings appear as **Brand belum dipetakan**.
This is the current account classification and does not infer brand from ad
names or URLs. Changing brand does not require another insights sync.
The Breakdown control changes table aggregation; select an individual row
for detail and clear its selection with the compact × control.

## Presenting CEP and campaign-objective cohorts

In **Performa**, select **CEP = Sendi**, **Objective Meta = Sales**, and
**Tampilkan = Per ad** to inspect each matching ad with the seven metrics.
Use **Per URL landing page** to aggregate that same cohort by destination.
Daily comparisons and weekly/monthly trends use the same filters. Filters are
temporary report choices; they do not rewrite saved monitoring or its alerts.

Objective comes from the ad's actual Meta campaign (`OUTCOME_SALES` for Sales),
not the naming intention `[conv]`. A `[cons]` ad in a Sales campaign qualifies.
Legacy `CONVERSIONS` remains a separate objective, and unreadable objectives
remain unknown. The official brand catalog and approved rules resolve the first naming bracket; `sendi` and `joint` share the Sendi key. Manual corrections take
precedence through stored generated dimension columns.

Reports follow the accounts in the selected monitoring and the global date
range. The matching-ad count covers ads with observed performance in that
period. The **Pemetaan Ads** page has the same CEP/objective/intention filters
over its inventory, including ads without delivery and outside the date range.

Inventory sync captures campaign ID/name/objective directly from Meta. Daily
insights now capture objective as well. Historical snapshots without objective
use current campaign metadata only when the account/campaign ID matches;
this fallback is an observed current classification, not a reconstruction of
past changes. CEP/intention use the current ad mapping. Updating creative
metadata does not erase these campaign dimensions or manual corrections.

## Date range and status

Meta reporting and its date presets stop at yesterday in WIB. Other dashboard
pages retain their existing date behavior. Comparisons use equally long closed
periods. Complete coverage produces no warning; missing account-days appear in
the compact Data/Pembanding parsial disclosure, with account and date details.
Unsaved or disabled monitoring uses the muted Notifikasi nonaktif indicator.

## Seven default metrics

| Metric | Calculation |
| --- | --- |
| Spent | Sum of Meta ad spend |
| CTR outbound link | Outbound clicks / impressions |
| LPV | Sum of landing-page views |
| LPV ratio | LPV / outbound clicks |
| ATC ratio | Add to cart / LPV |
| IC ratio | Initiate checkout / LPV |
| Purchase ratio | Purchases / initiate checkout |

Budget and budget utilization are intentionally omitted. Spent has a neutral
comparison because a higher spend is not inherently a performance decline.
All ratios use summed events, not averages of ad ratios. Zero denominators
produce unknown values; zero conversions with a positive denominator are zero.
Reach and frequency remain raw and are not summed across ads.

The overview provides a compact summary and seven metrics per destination;
ad names, creative thumbnails, and raw funnel volumes are in expandable details.
Advanced metric configuration is collapsed by default. Daily comparisons and
weekly/monthly trends use the same grouping and metric formulas.

## Destination rules and limitations

- Destinations come from the creative's direct link, link/video CTA,
  carousel/template links, or dynamic asset-feed URLs. An explicit destination
  takes precedence over a generic object URL.
- Normalize URL host and trailing slash, remove fragments and known UTM/click-ID
  tracking parameters, and sort query parameters. Functional query parameters,
  path case, and HTTP versus HTTPS remain distinct. No redirect crawling occurs.
- An ad with multiple different destinations is reported once in a separate
  multi-URL group. Meta ad metrics cannot establish which destination received
  each event; those metrics are never copied into each individual URL.
- Ads without a readable URL are grouped as **URL belum terbaca**. This describes
  API visibility, not the absence of a destination in Ads Manager. Their spent
  remains in the overview. Ambiguous/missing destinations do not trigger a
  specific landing-page decline alarm.
- Observed destinations are stored with daily fact snapshots. Old rows without
  destinations can fall back to a cache scoped by workspace, account, and ad.
  That cache describes the current creative, not the exact URL at historical
  delivery time. Historical backfills also use metadata observed during sync;
  insights do not supply historical click destinations.
- Failed creative reads preserve cached URLs when possible and produce warnings.
  Failed report pagination never replaces existing metrics or marks missing days
  complete. Daily metrics and coverage are replaced atomically.
- Partnership/existing-post ads can expose a destination in Ads Manager or the
  official preview while omitting it from creative API fields. Admin Meta users
  can use **Tetapkan URL** in the URL-quality panel after verifying Website URL
  in Ads Manager. The server records the authenticated verifier and binds the
  fallback to workspace/account/ad/creative. Empty API refreshes do not erase it;
  a different creative cannot inherit it. A captured historical creative keeps
  its own verified URL. Observed API/historical URLs take priority.
  Reverify if destination settings are changed. Group details identify verified
  fallbacks. This is explicit verification, not inference from ad-name tags or
  automated scraping of Ads Manager. Preview API returns an iframe rendered with
  JavaScript, so it is not used as an unattended backend HTML parser.

## Reporting and notifications

Meta reports use ad level, daily increments, impression-time action reporting,
and each adset's unified attribution setting. Dates follow account timezones;
alert cutoff uses WIB with a configurable attribution lag. Comparison periods
are equally long. Weekly trends begin Monday; calendar edge buckets are marked
partial. Missing coverage produces chart gaps instead of fabricated zeros.

Accounts in one report must use a single currency. Mixed-currency scopes display
an error while leaving configuration controls available; no conversion occurs.

Alerts require a saved landing-page monitoring configuration, one recognizable
destination, complete account/day coverage in both windows, and the configured
minimum spend, impressions, and denominator samples. New ads without a baseline
cannot be diagnosed through relative change. Default alerts monitor the six
funnel metrics, not spent.

Notifications are in-app (inbox and bell), deduplicated by configuration version,
URL group, metric, and period end. Read status belongs to each user. Alerts are
immutable observations; later attribution refreshes do not rewrite previous
alerts. Archiving monitoring removes its alerts from the inbox.

Insights describe observed changes and possible checks rather than proven
causes. Suspects retain account/ad/name identity and are ranked by current spend
among ads with a worsening metric and sufficient baseline. Small incidental
video events do not establish a weakening video hook; changes in image/video
delivery mix can also affect aggregate video ratios.

## Validation

```sh
npm run test:meta-funnels
npm run typecheck:app
npm run lint
npm run build
docker exec -i supabase_db_roove-bi-local psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < tests/meta-funnel-db.sql
docker exec -i supabase_db_roove-bi-local psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < tests/meta-ad-mapping-db.sql
docker exec -i supabase_db_roove-bi-local psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < tests/meta-ad-campaign-db.sql
```

The SQL test uses transaction rollback and reserved January 2000 dates. It checks
atomic replacement, destination persistence/validation, empty-day coverage,
workspace validation, RLS, and grants. The local preview's network guard blocks
live provider sync. During this task, Meta read-only reports and metadata were
copied into the isolated database without production writes. Browser verification
uses the normal login flow.

## Shopee destination evidence and metadata backfill

Migration `204_meta_ad_destination_metadata.sql` adds backend-only current
destination observations and a workspace/account-scoped verified Shopee product
set registry. These tables do not change daily performance facts or the current
report UI. Unknown destinations are not classified as non-CPAS.

`lib/meta-ad-destination-metadata.ts` reads Shopee app identity, store URLs,
omnichannel configuration, ad set promoted objects and product set IDs. CPAS
requires an explicit Shopee identity/URL or a separately verified product set;
generic app destinations, Canvas URLs, account names and unverified catalog IDs
are insufficient. A failed or opaque read leaves previous observations intact.
Catalog permission failures must be reported rather than worked around by
guessing catalog ownership. Product set verification reads every available
product URL across all pages; every returned product must have a Shopee URL.
Empty, inaccessible, mixed or incomplete product sets remain unverified. A
verified product set with a conflicting external website stays unknown unless
the ad also supplies a direct Shopee URL/app identity. API observation time is
not historical delivery time.

Run the backfill explicitly against the intended environment:

```sh
node --import tsx scripts/ops/backfill-meta-ad-destinations.ts --workspace=<workspace-uuid> --apply
node --import tsx scripts/ops/verify-meta-shopee-product-sets.ts --workspace=<workspace-uuid> --apply
```

Without `--apply`, the command reads metadata and writes only a local checkpoint.
It visits the union of stored creative, mapping and daily-fact ad IDs, including
paused ads and inactive accounts. `--max-batches=1` limits a canary to 50 ads.
`--resume` skips successfully saved checkpoint entries and retries failed ones.
Checkpoints default to ignored `.local/` files; do not commit them. Token expiry
or rate limits stop the run. No Insights requests or sync queue jobs are created.
The verifier's `--reclassify-only` option reuses the stored verified registry
without querying product sets again. `--unverified-only` checks only product sets
that do not already have a verified registry entry.

After the updated worker is deployed, scheduled/manual mapping creative jobs
refresh these observations in batches of 50 ads (one creative batch request plus
one destination batch request). Page reads never request this metadata. Deploy
migration 204 before deploying the worker change.

## Automatic verification of new product sets

Apply migration `205_meta_product_set_auto_verification.sql` before deploying
the updated app and worker together. Drain the previous worker before switching
releases: it does not understand the `verify_shopee_product_set` payload.

Daily 17:00 WIB sync and explicit manual sync discover product sets while saving
ad destination metadata. Each new workspace/account/product-set identity queues
one `meta_sync` job in mode `meta_product_set_verify`. Active-job deduplication
uses a stable key without a calendar day. The job has mapping markers so mapping
and global Meta progress include it. Page loads do not enqueue verification.

Product reads share a 20-second cancellation budget and follow every page before
accepting Shopee evidence. A successful check records the verified product set
and updates all currently observed ads referencing it, including ads without a
direct URL. A verified Shopee product set is definitive CPAS evidence, including ads whose creative also links to a brand website. The write
RPC updates classification/evidence only when the source metadata still matches;
it cannot overwrite a new creative observation or performance metrics.

Known verified product sets reuse their registry entry. Empty, inaccessible,
non-Shopee, incomplete or timed-out checks record an explicit warning and a
cooldown until the next midnight in WIB. Repeated jobs in the same day do not
make further product API requests. The next scheduled/manual sync after that
deadline may try again. Existing direct app/URL evidence stays intact.

Additional local database validation:

```sh
docker exec -i supabase_db_roove-bi-local psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < tests/meta-product-set-db.sql
```

### Pengelompokan CPAS dan Non-CPAS

Migration `206_meta_ad_channel_groups.sql` menambahkan dimensi jenis iklan pada
performa dan inventori pemetaan. Pilihan awal adalah **Non-CPAS**. Pilihan
**CPAS** memakai bukti Shopee yang sudah tersimpan, termasuk product set
terverifikasi tanpa URL. **Perlu verifikasi** menampung tujuan yang belum cukup
jelas, katalog belum terverifikasi, atau creative yang berubah.
Nama akun, nama katalog, dan generic app bukan bukti CPAS maupun Non-CPAS.
Non-CPAS memerlukan sumber yang teridentifikasi bukan Shopee: website eksternal,
tujuan pesan/native, atau katalog non-Shopee yang terkonfirmasi. Ketiadaan URL
akibat kegagalan API/preview tidak menjadi bukti bahwa tujuan Shopee tidak ada.

Aturan pembagi: katalog Shopee **atau** URL/identitas aplikasi Shopee cukup untuk
CPAS, meskipun bukti yang satunya tidak ada. Tanpa sumber Shopee, iklan masuk
Non-CPAS; katalog RTI yang broken tetap Non-CPAS. Data sumber yang belum berhasil
dibaca adalah masalah kelengkapan data, bukan jenis iklan ketiga.

Filter jenis iklan diterapkan di database sebelum penggabungan landing page,
total brand, rasio, histori, dan detail creative. Cache menyertakan jenis iklan
dan berubah ketika metadata tujuan/registry product set diperbarui. Web selalu
mengirim satu jenis iklan; RPC yang dipanggil integrasi tanpa `p_filters.channel`
mempertahankan perilaku sebelumnya. View pemetaan hanya dapat dibaca service
role setelah pemeriksaan akses workspace oleh server action.

Klasifikasi berdasarkan bukti tujuan terkini, bukan rekonstruksi tujuan historis.
Jika identitas creative/adset pada fact diketahui berbeda, fact masuk Perlu
verifikasi. Fact lama tanpa creative ID mengikuti creative terkini, sesuai aturan
resolusi URL report sebelumnya. Jumlah ad di pilihan mengikuti periode/filter
aktif; satu ad yang berubah creative dapat muncul dalam lebih dari satu kelompok
pada tanggal berbeda, tetapi setiap fact dan total metrik hanya masuk satu jenis.
Inventori pemetaan menghitung semua tanggal dan mencakup ad tanpa delivery.

Tahap ini hanya memisahkan kelompok iklan. Metrik purchase shared items serta
pilihan atribusi 1 hari/7 hari belum ditambahkan; tampilan CPAS menjelaskan batas
tersebut. Membuka halaman, mengganti kelompok, dan memuat ulang tetap hanya
membaca database, tanpa menjadwalkan sync.

Validasi lokal: `npm run test:meta-funnels`, `npm run test:meta-report-db`, `npm run test:meta-channel-db`,
`npm run test:meta-cpas-catalog-db`, dan `npm run test:meta-destination-cache-db`. Uji database menggunakan container lokal tetap
dan transaksi fixture yang di-rollback; tidak ada opsi target production.

Migration `208_meta_ad_destination_evidence_cache.sql` menyimpan hasil backfill
provider pada tabel service-only `meta_ad_destination_resolutions`, terikat ke
workspace/account/ad/creative/adset. Simpan URL kanonis, jenis sumber, waktu,
dan bukti terstruktur; jangan menyimpan HTML, signed iframe URL, token, atau
media pada tabel ini. Root `creative.call_to_action` ikut dibaca saat sync biasa
agar URL existing post/partnership yang tersedia langsung tidak terlewat.

Trigger database memakai kembali hasil yang cocok ketika observasi sync tidak
mengandung URL, termasuk dari worker versi lama. URL terstruktur terbaru tetap
diutamakan; creative/adset yang berubah tidak mewarisi bukti lama. Migration
`209_meta_native_destination_evidence.sql` juga melekatkan bukti tujuan native
saat URL profil terstruktur masih sama. Katalog/app yang belum terverifikasi
tetap menghalangi penetapan Non-CPAS, termasuk ketika ada cache URL website.

Migration `210_meta_confirmed_non_shopee_catalog.sql` menerima konfirmasi pengguna
tentang katalog non-Shopee sebagai `user_catalog_confirmation`, dengan jenis
`non_shopee_catalog` dan daftar product set yang dikonfirmasi pada proof. Ini
mengatasi katalog kosong/broken yang identitas induknya tidak dapat dibaca API.
Bukti melekat hanya pada workspace/account/ad/creative/adset yang sama, menutup
seluruh product set pada observasi, dan tetap berlaku bila URL website berubah.
Katalog baru yang belum dikenal tidak mewarisi konfirmasi lama. Bukti Shopee
yang positif selalu diprioritaskan di atas konfirmasi katalog non-Shopee.

Backfill preview menggunakan preview resmi Meta di komputer lokal tanpa model
AI. Pilih target CTA/kartu yang eksplisit, bukan URL pada caption atau profil
pengiklan. Bukti yang diwarisi dari existing post dicatat sebagai
`inherited_existing_post_cta`, bukan pengamatan langsung target: ID post dan
jenis CTA harus sama, sumber memiliki URL eksplisit yang konsisten, dan target
tidak memiliki override tujuan sendiri. Tujuan video native memerlukan bukti
konfigurasi dan preview, bukan hanya `ON_VIDEO` tanpa URL.

Render browser otomatis saat sync dan tombol refresh tujuan manual belum
diterapkan. Refresh manual nantinya perlu menangani existing post yang berubah
tanpa creative ID berubah. Render yang berhasil tidak perlu diulang pada sync
biasa; kegagalan pencarian nantinya memerlukan cooldown retry. Pembacaan halaman
tidak merender preview atau membuat pekerjaan sync.

Aturan bisnis katalog Shopee: product set yang terverifikasi milik Shopee selalu
menentukan CPAS meskipun creative memuat URL brand, termasuk roove.co.id.
Migration `207_meta_shopee_catalog_priority.sql` memperbaiki klasifikasi lama
yang ditahan sebagai konflik URL. Registry harus cocok workspace dan akun serta
product set yang benar-benar ada di metadata; nama katalog/akun tidak cukup.
Migration hanya memperbarui classification/evidence, mempertahankan URL asli,
creative/adset, waktu observasi, serta semua metrik delivery.


### CTWA grouping and templates (migration 213)

CTWA destinations are grouped by workspace, the account's mapped brand, and the
normalized international WhatsApp phone. The same brand/phone merges across ad
accounts; different brands or phones never merge, even when their displayed URL
is `https://api.whatsapp.com/send`. Page IDs are evidence, not an automatic brand
assignment. Existing account-brand mapping remains authoritative.

Only current creative/adset metadata can contribute a stored phone. Explicit
WhatsApp send/wa.me destinations are also supported. Ordinary website pages
containing a WhatsApp button remain website destinations. Strong CPAS evidence
takes priority. One ad with multiple conflicting phone destinations stays in a
single ad-scoped group rather than multiplying spend. Missing numbers are
isolated by brand/account/Page, or by ad when Page is unavailable; no phone is
inferred from another ad. Reporting uses the identity currently available for
the matching creative/adset, not a historical audit of phone changes.

The template matching screen uses one landing-page mapping table for Website
and CTWA. Each row shows its URL, with the WhatsApp number underneath and the
brand in the existing Brand column. Identical URLs can appear on distinct
brand/phone rows. Mapping retains Spend, evidence, Template and Status; it has
no separate CTWA table, conversation-cost columns or CTWA totals. The brand
performance report retains separate destination rows and per-template totals,
with no additional CTWA summary card.
Costs and ratios are recalculated from summed raw counts, never averaged from
row costs. Different currencies are not shown as one monetary total.

A `ctwa` template rule stores the opaque destination key. Choosing a template
on one CTWA row changes only that brand/destination. Many destinations can use
the same saved template, while retaining separate metrics, trends, creatives,
and alert groups. Existing global URL rules remain a fallback until a scoped
CTWA rule is assigned; conflicting matches across URL variants do not pick an
arbitrary template. If a missing number later becomes known, its new phone key
needs its own assignment (or a matching shared URL rule).

Deploy migration `213_meta_ctwa_destination_groups.sql` before the app release.
It changes report grouping and extends rule validation; it does not update
historical metric rows, brand mappings or existing template assignments. Report
cache namespace is bumped with the application release.

Validation:

```sh
npm run test:meta-funnels
npm run test:meta-ctwa-db
```

The database test uses the fixed local Docker clone and rolls back all fixture
writes. Before installing 213 locally, use `node tests/meta-ctwa-destinations-database.mjs --with-migration`
to test the migration itself inside the rollback transaction.

### Instagram Profile Visits

Sync harian mengambil field Ads Insights `instagram_profile_visits` untuk seluruh ad. Nilai eksplisit `0` disimpan sebagai nol; field/baris yang tidak dikembalikan Meta disimpan sebagai `null` dan tampil tidak tersedia. Agregat yang mencakup histori belum lengkap juga tetap tidak tersedia, agar biaya per profile visit tidak menyesatkan. Event ini tersedia pada editor template; tidak mengubah template atau aturan URL yang sudah ada.

Migrasi 214 memperluas agregat JSON dan menyediakan RPC service-only untuk backfill. Snapshot dari worker lama mempertahankan observasi backfill yang lebih baru pada workspace/account/ad/day/adset yang sama.

Jalankan `scripts/ops/backfill-meta-instagram-profile-visits.cjs` **di server aplikasi** dengan `--app-root <release>` dan `--backup-dir <direktori privat absolut>` untuk mengumpulkan seluruh histori harian yang sudah tersimpan. Semua halaman Meta harus berhasil sebelum payload akun disimpan. Setelah migrasi dan pemeriksaan ringkasan, jalankan dengan `--apply-cache <direktori yang sama>`. Kredensial dan backup tetap di server; script hanya memperbarui metric Profile Visits serta audit observasinya, tidak membuat fact baru atau memicu sync. Baris dengan adset berbeda atau observasi lebih baru dilewati. Akun gagal dicatat pada manifest; ulangi koleksi akun tersebut setelah kendala selesai.

### Incremental metadata and progress (migration 215)

The light `/ads` inventory still discovers all ads, including paused/no-spend ads. Inventory jobs run before metric snapshots to invalidate changed cache certificates; metric jobs use certified cache entries and never perform rich provider reads. New/changed destinations resolve through the existing report fallback after enrichment. Rich creative and destination reads run only for missing caches or changes to the ad/creative/ad set source fingerprint. The fingerprint includes both provider update timestamps, ad-set identity, destination type, and promoted object. Successful pre-migration observations can be adopted when their identities match and both cache timestamps cover the provider timestamps. Failed/opaque observations are not certified; they remain eligible for the next sync. Existing post/preview proof stays scoped to its creative and ad set and is never rendered automatically. Unverified product sets are checked separately when their retry cooldown expires, even when the ad metadata is unchanged.

`meta_ad_metadata_sync_state` records successful versions. `meta_sync_job_links` links spend, metrics, inventory, creative and product-set jobs, including reused active jobs. Progress recursively reads descendants, deduplicates IDs, and checks workspace/provider scope. It includes a read-only compatibility path for pre-migration runs. The dashboard shows independent metrics, metadata and catalog states; a catalog warning does not mark metric delivery as partial. The metric timestamp comes only from metric jobs.

The worker drains sequentially up to 100 jobs or 240 seconds per invocation, then resumes on the existing minute timer. The time budget is checked between jobs and never interrupts an in-flight provider request. Meta remains scheduled once at 17:00 WIB; deployment and page reads never enqueue a sync. Deploy the new worker override only after the previous sync and worker have completed, with the previous override backed up for rollback.

Validate migration 215 on a local clone with `npm run test:meta-incremental-db` (or add `-- --with-migration` before it is installed). The fixture transaction rolls back and checks descendant counts, legacy compatibility, workspace/provider isolation, cache certification and deferred URL resolution without changing metric facts.

### Incremental detail and mapping reads (migration 223)

Detail Brand uses one `get_meta_brand_detail_report` RPC instead of three
application RPCs. It scopes active accounts to the selected brand first, then
returns Website, CPAS and the active CEP view. The three views still aggregate
separately inside the database. Detail, focused history and creative drawers use
`get_meta_ad_report_incremental`, sharing migration 222's certified daily
projections; current taxonomy, coverage and template rules remain live. The
original `get_meta_ad_report` is retained for parity checks and recovery.

The browser retains bounded five-minute detail/history caches by authenticated
user, permissions, workspace, dates, brand, world and filters. Revision checks
refresh changed data on revisit. Repeated pending requests share a result; a
forced refresh after a mutation waits for an older read and then rereads.
Responses from a previous scope cannot replace the current page. Trends load
after the main content, with charts and drawers split out of the initial bundle.

Pemetaan Ads reads channel evidence once from `meta_ad_mapping_channels`, loads
the workspace catalog/rules once and resolves taxonomy in the application. This
avoids the per-row SQL taxonomy lookup repeated by offset pages of
`meta_ad_classifications`. It derives dimension choices from that same inventory.
The application resolver follows migration 218's aliases, manual precedence,
multi-CEP memberships (including archived and legacy/prefixed identities), source
labels and stored-token normalization. Keep `test:meta-taxonomy-db` passing against
the SQL resolver when either implementation changes.
A bounded process-local cache retains inventory
independent of paging, search, dates and filters; activity is cached separately
by date range. Both use workspace/revision keys and five-minute expiry. A
process-local cache avoids Next's 2 MiB serialized-entry limit on large
inventories. It is not shared between server processes. Failed/incomplete reads
are not cached. Every server action checks access before reading these caches.
Inventory and activity misses overlap, with one loader per source per process;
identical requests still share one pending result. This cold-load optimization
requires no migration beyond the existing 218–223 schema.
Sync polling reads only job/status/revision data and reloads the worklist when
its revision changes. Mutation actions remain live and force a client refresh.

Apply only reviewed `223_meta_detail_incremental_reports.sql` after 222, before
activating this application version. It adds service-only RPCs and extends the
projection with creative identity. It clears only the derived daily cache once;
source facts, mapping overrides and template assignments are unchanged. First
use rebuilds requested dates. The previous application remains compatible with
the additive schema, so app rollback can retain this migration. Snapshot the
replaced `refresh_meta_brand_report_days` definition/grants for recovery; do not
replay older migrations or reset the local snapshot.

Validation:

```sh
npm run test:meta-funnels
npm run test:meta-detail-mapping-db
npm run test:meta-taxonomy-db
npm run test:meta-detail-mapping-db -- --benchmark
npm run typecheck:app
npm run lint
npm run build
```

The database runner installs 222/223 and fixtures in one rollback-only transaction
on the fixed local database. It compares all raw report fields across 288
grouping/view/filter combinations, both detail worlds, an empty brand, cache
reuse, permissions and the existing overview/invalidation regression cases.
React tests cover shared pending loads, remount reuse, scope changes, forced
mutation refreshes and retry after failures.

On the reduced local sample, three old detail RPCs took 427 ms of serial database
time; the batch took 399 ms cold and 346 ms with projections populated. A 90-day
history read changed from 93 ms to 53 ms cold / 52 ms warm. These are sample query
measurements, not production page-load times or a concurrent-load test. The
production build's Detail Brand first-load JavaScript is 177 kB (previously
277 kB); the deferred chart/drawer code downloads when used.

On 19 October 2026, two read-only comparisons from the production host against
release `c8dfb7a6008e0600503bc5c5839ed97ef79342fc` measured cold inventory loading
at 7,731 / 7,260 ms before and 1,569 / 1,498 ms with the application resolver.
Inventory plus activity changed from 9,187 / 7,354 ms to 1,569 / 1,498 ms.
All 4,765 active-account inventory rows, activity, and 66 worklist results
(paging, search, inactive ads, issues, channels, accounts and taxonomy filters)
matched exactly at a stable report revision. These are application loader
measurements with empty process caches, not full browser navigation times or
database cold-cache/concurrent-load guarantees. The candidate ran only as a
standalone read-only diagnostic; deployment remains a separate release action.
The rollback-only local taxonomy test additionally compared 5,405 classifications
against SQL, including explicit nulls, aliases, archived keys and brand isolation.

### Report database load

The application permits at most two report RPC cache misses at once per process,
including requests from different brands/routes. Identical workspace, revision
and query scopes share an in-flight request; different scopes never share a result.
The five-minute cache and database revision invalidation still apply. Batched
overview/detail RPCs use the same limit. Mapping inventory/activity cache misses
have independent sequential loaders, allowing those two sources to overlap.
Expected database failures return a safe retry message in overview/detail.

For release verification, test authenticated overview and both brand worlds with
an uncached month-to-date range as well as seven days. The 1–17 October incident
passed isolated RPC checks but exceeded the database's eight-second limit when
the page launched its reports together. No database timeout increase or additional
migration was required for that earlier application concurrency fix. The current
batched reporting implementation requires migrations 222 and 223.


### Personal result columns

The brand detail Website & WhatsApp tables expose **Atur kolom** on each template.
Users can show/hide existing template metrics and the Funnel summary, reorder
with drag handles or up/down buttons, and reset to template defaults. Tujuan
stays first. At least one other column must remain visible. Apply persists the
choice; Cancel and Escape discard the draft. Header, body and total rows use the
same column sequence. Monitoring, metric formulas and drawer contents are unchanged.
CPAS uses a fixed report without a template, so it does not expose this setting.

Migration **225_meta_funnel_column_preferences.sql** adds private preferences
keyed by authenticated user and template. A template reused across brands shares
that user's preference; other users keep their own choices. Server actions check
the session, workspace and template access, including advertiser account scope.
Direct anon/authenticated table access is revoked; only the server service role
can read/write rows. Reset restores only the current user's column defaults for
that template, preserving its saved row sort. Removed metrics are ignored and newly added metrics appear at the end.
Deleting a template or user cascades its preferences. If migration 225 or 226 is absent,
reports retain their default columns and show a settings-unavailable notice.
Apply this migration deliberately as part of an authorized release, before the
application deployment; it does not modify report data or template definitions.

Validation: `npm run test:meta-funnels`, `npm run test:meta-columns-db`,
`npm run typecheck:app`, `npm run lint`, and `npm run build`.
The database test uses only the fixed local container, installs migrations 225/226
and fixtures in a rollback-only transaction, and checks per-user/template keys,
scoped reset, grants/RLS, constraints and cascade deletion. It preserves the
existing local schema and data. UI tests cover ordering/visibility alignment,
reset/cancel, failed saves, minimum visible columns and template reconciliation.


### Result row sorting

Click a result column heading to toggle descending/ascending order. Numeric
metrics use their unrounded current value; missing/non-finite values remain last
in both directions, and ties preserve report order. Tujuan/Ad toggles A–Z/Z–A
with natural numeric comparison. The composite Funnel column includes a stage
selector: its first stage sorts by count, later stages by the displayed ratio
to the preceding stage. This also works in CPAS result tables.

Sorting follows the selected metric when columns are moved. Hiding the active
column clears its sort; a removed metric/stage is ignored. **Urutan awal** restores
the report's original order without changing visible columns or their sequence.
Totals, formulas and drill-down contents remain unchanged.

Migration **226_meta_funnel_sort_preferences.sql** adds a nullable sort to the
existing private per-user/per-template preferences. It stores the column key,
direction, and (for Funnel) stage. Returning to the page or signing in again loads
that preference; brands using the same template share it for that user. CPAS has
no template ID and keeps local sorting only.

The service-only `save_meta_funnel_table_preference` RPC atomically patches either
columns or sorting, so independent writes/resets cannot overwrite the other part.
Empty column order means template defaults. Hiding the active sort column clears
sorting in the same write; a concurrent sort save cannot select a hidden column.
Server actions verify the session/workspace/template and validate keys against the
current template. The RPC is security-invoker and is not executable by browser
roles. Apply migration 226 before deploying this code; no report data or template
configuration changes. Existing 225 preferences are preserved with no saved sort.
An app rollback can leave 226 in place (the older app will not preserve sorting).

Sort controls wait for preferences to load and are disabled during a save. A
successful save updates the sort and confirms it on screen. A failed save keeps
the previous order and shows an error; clicking the desired heading retries it.
Validation includes 272 Meta tests, rollback-only database coverage of both patch
types and resets, viewer/template isolation, RPC grants, constraints, asynchronous
restore, reopening, Funnel stage, pending-save guards and failed-save recovery.

## Brand-scoped business editing (migrations 227–228)

The `meta:mapping`, `meta:taxonomy`, and `meta:funnels` permissions independently
control ad corrections/verified destinations, CEP and intention catalogs/rules,
and funnel templates/destination rules. They do not imply `admin:meta`.
Integration configuration, credentials, connected accounts and sync requests
remain behind `admin:meta`; advertisers cannot invoke the sync entry points.
The permission matrix exposes the three keys under **Meta Ads — Pengelolaan**.
Migration 227 preserves existing editors by copying their current `admin:meta`
grants once and gives Advertiser the three business keys. Future permission
changes are independent. Meta page access is still required.

Advertiser scope comes from the active workspace membership and its assigned
brands. Canonical `meta_ad_accounts.default_brand_id` determines an ad's brand;
no mutation accepts a caller-supplied brand for an existing ad, funnel or rule.
The private `mutate_meta_brand_configuration` RPC derives existing-row scope and
rechecks current membership, permission and brand assignment in the write
transaction. Profile/membership/grant locks serialize writes with revocation.
The authenticated actor is supplied by the server session, never by client input.
Browser/anonymous roles have no direct table or mutation-RPC privileges.

Funnel and destination-rule `brand_id=NULL` denotes a legacy shared template.
Advertisers may inspect relevant shared templates and copy their configuration
into one assigned brand, but cannot edit/archive shared templates or delete their
rules. Brand scope is immutable; copy rather than move a template. Editors assigned
to the same brand may edit each other's brand templates. Brand-scoped rules take
precedence over matching shared fallbacks, and are filtered before matching URLs;
the same URL can therefore use different funnels in different brands. A shared
rule not matched by the advertiser's scoped landing pages is not exposed in the
editor. Alert evaluation and MCP reporting also enforce the template's brand.

Intention catalogs are now owned by each brand. Existing brands are seeded with
Discovery/Consideration/Conversion; new brands receive the same defaults.
Additional stable keys use `b<brand-id>.<slug>`. Labels/definitions are editable;
identity cannot change. Deactivation hides a choice from new assignments but
preserves existing mappings, rules and historical reporting. Rule-based and manual
custom intentions appear in worklists, filters and the CEP × intention matrix.
Category/rule revision checks reject stale edits; funnel version checks do likewise.

Validation: `npm run test:advertiser`, `npm run test:meta-funnels`, and
`npm run test:meta-brand-edit-db`. The last command uses only the verified local
sample container, installs missing prerequisites inside a single transaction,
checks denied/allowed operations, and rolls back schema and fixtures. Do not run
it against production. No sample data is part of either migration.

Release only after review: apply 227 followed by 228 before activating this code.
227 changes the URL-rule uniqueness key to include brand; older application code
uses the previous conflict target and cannot edit URL assignments after this
migration. Consequently an application-only rollback to pre-227 is not a complete
editor rollback. Prefer a forward fix; a schema rollback needs a separately
reviewed preservation/mapping plan for newly created brand templates, rules and
intentions. Never drop these new records merely to restore the old constraint.
