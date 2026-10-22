# Meta partnership breakdown

The Website & WhatsApp destination tables offer Format iklan, Optimasi and
Partnership in the existing control next to Atur kolom. The choice is saved per
workspace/user in the browser. Partnership subrows reuse the template's columns,
current/prior ad cohorts and summed-event ratios; they do not add another table.

## Evidence and limitations

The bounded creative reader requests only `branded_content_sponsor_page_id`,
`facebook_branded_content{sponsor_page_id}`,
`instagram_branded_content{sponsor_id}` and `branded_content{ad_format}` alongside
its existing fields. A valid sponsor in either platform (or the legacy field)
is positive evidence. No name, UGC wording, actor ID, thumbnail or ad-format enum
is used to infer a partnership.

Non-partnership is an operational classification: the identified creative's
requested metadata read succeeded and returned no sponsor or branded-content
configuration. It does not guarantee Meta exposed every permission-dependent
field. The row tooltip states this limitation. Legacy/uninspected data, failed
reads, mismatched creative IDs, malformed evidence and branded configurations
without an identifiable sponsor remain Belum diketahui. Do not relabel all empty
historical metadata as non-partnership.

A failed optional-field request retries the original creative fields only for
failed ads, retaining format/URL enrichment and marking partnership unknown.
No raw branded-content object or boost token is stored. Normalized metadata is
bound to the existing workspace/account/ad/creative cache and its updated_at.
The report describes the latest synchronized setup, applied consistently to
current and comparison cohorts. It is not a historical partnership snapshot.
Known historical creative IDs must match; missing historical IDs may use the
inventory-matched current creative, as in format reporting.

## Release and population

Requires reviewed migration `235_meta_partnership_breakdown.sql` after 234,
before activating the app or its worker. It adds nullable normalized metadata
and replaces the existing report function; grants remain service-only. Existing
creative-write triggers invalidate report revisions. Server report cache keys
are versioned for the new response.

No migration fills or fabricates statuses. The next normal metadata sync refreshes
legacy creatives that are active or delivered in the last 30 days, using the
existing bounded queue. Failed/unknown inspections become eligible to retry after
24 hours. Long-paused ads are deferred under the existing policy; completeness
for older date ranges requires a deliberate targeted metadata backfill. No
historical spend/insights backfill is needed, and this change does not start sync.

Local validation uses the existing rollback database harness: migration and
synthetic test rows are rolled back together. Do not replay historical migrations
in production. Keep the prior application release for rollback; the nullable
additive column can remain if the app is rolled back.
