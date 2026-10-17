# Meta Ads: brand-first ad quality reporting

Available in Marketing Channel → Meta Ads (`/dashboard/meta-funnels`). Every
Meta Ads page shares one sub-navigation: Ringkasan brand, Pemetaan Ads,
Notifikasi, Template funnel.

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
- Legacy `?view=alerts` and `?view=mapping` links still redirect.

Only Ringkasan brand and Detail brand show the global completed-days date
picker; the other pages have their own context.

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
performance report retains separate destination metrics and CTWA brand totals.
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
