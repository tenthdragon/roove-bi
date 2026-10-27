# Manual Shopee and TikTok ad spend

Roove and Apurva Workspaces use advertiser-entered daily spend for Shopee Ads and TikTok Ads
from **1 October 2026**. Each entry belongs to one active brand, one platform,
and one date. The advertiser's number is the BI MKT Fee record; the platform
dashboard remains the place to inspect actual platform metrics. Meta Ads keeps
its automatic sync.

The owner grants Shopee Ads and/or TikTok Ads separately for each active
advertiser in **Admin → Users → Hak input biaya iklan**. A grant covers every
active brand in the workspace. An advertiser with neither grant does not see
**Marketing Channel → Input Biaya Iklan**. The page has one section for each
granted platform. Advertisers can correct or remove their own entries without
approval; creation, correction, deletion and grant changes retain audit rows.
Owners can inspect entries and their audit log, but cannot enter or change spend.

Migration `239_manual_marketplace_ad_spend.sql` enables the cutover for both
workspaces (`roove` and `apurva`). It requires both to exist, then copies legacy rows to
`manual_marketplace_legacy_spend_archive` before removing them from
`daily_ads_spend`. Only Google Sheets, XLSX and Shopee Ads API spend from the
cutover date are affected. Facebook CPAS (Meta API), Shopee Live, and earlier
dates are kept. The importer and a database trigger prevent older workers from
putting replaced rows back. The Shopee API may still collect its platform
metrics; its spend is no longer projected into BI after cutover. The archive and
suppression rules are scoped separately by workspace, so either workspace may
have no legacy rows without affecting the other.

The deployment order is migration first, then the application. Review the
production migration history and the archived-row count before activating the
new release. The resulting MKT Fee for unfilled dates is intentionally empty;
advertisers should enter the October daily amounts for every active brand in
each workspace.
Do not restore the archive into `daily_ads_spend` while the cutover row exists,
because imports for that scope will be suppressed.

After release, verify one granted advertiser with each platform combination
(Shopee only, TikTok only, both), one ungranted advertiser, owner read-only
access, and direct URL/write denial. Confirm that creating, editing and
deleting an entry changes exactly one `daily_ads_spend` row with
`data_source = 'manual_marketplace'` and creates an audit row each time.
