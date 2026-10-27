# Manual Shopee and TikTok ad spend

Roove and Apurva Workspaces use advertiser-entered daily spend for Shopee Ads and TikTok Ads
from **1 October 2026** when an advertiser has entered a value for a date, brand,
and platform. Otherwise, the latest available Google Sheet ads row supplies
the BI MKT Fee for that key. A manual value of zero is still an explicit input
and suppresses the sheet value. The platform dashboard remains the place to
inspect actual platform metrics. Meta Ads keeps its automatic sync.

The owner grants Shopee Ads and/or TikTok Ads separately for each active
advertiser in **Admin → Users → Hak input biaya iklan**. A grant covers every
active brand in the workspace. An advertiser with neither grant does not see
**Marketing Channel → Input Biaya Iklan**. The page has one section for each
granted platform. Advertisers can correct or remove their own entries without
approval; creation, correction, deletion and grant changes retain audit rows.
Owners can inspect entries and their audit log, but cannot enter or change spend.

Migration `239_manual_marketplace_ad_spend.sql` enabled the initial cutover for both
workspaces (`roove` and `apurva`). It requires both to exist, then copies legacy rows to
`manual_marketplace_legacy_spend_archive` before removing them from
`daily_ads_spend`. Migration `240_marketplace_spreadsheet_fallback.sql` stores
Google Sheet rows in `manual_marketplace_sheet_fallback` and projects only the
effective source into `daily_ads_spend`. It seeds the retained October archive
and converts the one-time 27 October owner-attributed backfill into spreadsheet
fallback rows; advertiser-entered rows are left untouched. The database trigger
switches source immediately on manual create, correction, and delete. A sheet
sync refreshes the retained fallback even while manual spend is active. XLSX
uploads and Shopee Ads API spend remain suppressed after cutover, while Meta
CPAS, Shopee Live, and earlier dates are unaffected. Each workspace is scoped
independently; Apurva can have no archived rows without affecting Roove.

The deployment order is migration first, then the application. Review the
production migration history and archived-row count before activation. The
sheet fallback is only available for dates and brands actually present in
the sheet; an absent sheet value remains empty. Do not manually restore archive
rows into `daily_ads_spend`; migration 240 seeds and projects them with source
priority and audit behavior.

After release, verify one granted advertiser with each platform combination
(Shopee only, TikTok only, both), one ungranted advertiser, owner read-only
access, and direct URL/write denial. Confirm that creating, editing and
deleting an entry switches exactly one date/brand/platform between
`manual_marketplace` and `google_sheets` effective rows, without summing both,
and creates an audit row each time. Verify a zero manual input suppresses a
nonzero sheet fallback, a later sheet sync updates the retained fallback without
overriding manual, and deletion restores the latest sheet amount.
