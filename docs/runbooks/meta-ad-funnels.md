# Meta Ad Funnels: landing-page performance

Available in Marketing Channel → Meta Ad Funnels (`/dashboard/meta-funnels`).

The performance page keeps one filter area across Performa, Comparison harian,
and Tren. The header's **Pemetaan Ads** link opens `/dashboard/meta-funnels/mapping`.
The global notification bell opens `/dashboard/meta-funnels/notifications`.
Both pages have their own context and omit the global performance date picker.
Legacy `?view=alerts` links redirect to the notification page.
The primary report groups ad-level performance by **landing-page destination URL**.
Naming-based configurations from earlier development remain stored but are
excluded from this report, scheduled monitoring, and notification inbox.

Marketing access permits reporting and per-user notification acknowledgments;
`admin:meta` additionally permits configuration, archive, and manual sync. All
server reads and writes use the authenticated user's active workspace. Reporting
tables and the snapshot RPC have no browser grants.

## Enable in production

1. Apply `198_meta_ad_funnels.sql`, `199_meta_ad_landing_pages.sql`, and
   `200_meta_verified_ad_destinations.sql`, `201_meta_ad_mappings.sql`, and
   `202_meta_ad_campaign_dimensions.sql` using the
   normal migration process. This task applies migrations to the local clone only.
2. Deploy the app and sync-job worker together. The worker must understand
   `meta_sync` jobs with `ad_funnels_only: true` before processing them.
   Mapping jobs additionally use `ad_mapping_only: true`.
3. Confirm an active Meta integration and connected ad accounts in Admin Meta.
4. Save landing-page monitoring with the desired accounts, decline threshold,
   minimum samples, window length, and attribution lag.
5. Use **Sync 90 hari** to initialize metrics and destinations. Jobs fetch one
   account and at most seven days each, newest weeks first. Follow progress in
   **Status sync histori**.

After successful scheduled account-spend sync, the existing scheduler queues
the most recent seven days of ad data for accounts used by saved landing-page
monitoring configurations. A coverage record for yesterday refreshed today
prevents repeated backfills on every ten-minute tick. Keep the worker running
and scheduled Meta sync enabled; no additional scheduler is required.

## Automatic granular ad mapping

The **Pemetaan Ads** page reads a persistent inventory keyed by workspace,
account and ad ID. Ad names are descriptive and mutable; two ads with the same
name remain separate identities. Mapping is independent of the report's date
range and of whether the ad has spent or delivered.

After each successful scheduled Meta account sync, accounts without an inventory
refresh today receive one mapping job each. No saved funnel is required. The
worker reads the `/ads` edge with full pagination before saving any mappings.
Creative destinations are refreshed in follow-up jobs with at most 100 ads
(two Meta batch requests) each. This avoids Meta's response-size limits and a
single large account exceeding the HTTP worker's 60-second execution window.
Inventory mapping completes before these jobs run; URLs can fill in afterward.
Missing creative data preserves mapping and previously cached metadata.
**Sync pemetaan** can request another refresh sooner. This is polling, not an
instant webhook. Ads omitted by Meta are retained rather than marked deleted.

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
remain unknown. The first naming bracket supplies CEP according to the mapping
rules above; `sendi` and `joint` share the Sendi key. Manual corrections take
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
