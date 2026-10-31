# Manual Shopee and TikTok ad spend

Roove and Apurva Workspaces use manually entered daily spend for Shopee Ads and TikTok Ads
from **1 October 2026** when an authorized user has entered a value for a date, brand,
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
Owners and active workspace admins can enter both platforms without advertiser
grants, and inspect entries and their audit log. Like advertisers, they can
correct or remove only their own entries. Access follows the active workspace;
an admin role in another workspace does not grant access here.

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

Migration `242_manual_marketplace_spend_owner_admin.sql` adds owner/admin write
access by replacing only the save/delete functions. It does not change existing
spend rows, advertiser grants, source priority, or audit triggers. Capture the
current definitions/grants of those two functions before release for rollback.

The deployment order is migration first, then the application. Review the
production migration history and archived-row count before activation. The
sheet fallback is only available for dates and brands actually present in
the sheet; an absent sheet value remains empty. Do not manually restore archive
rows into `daily_ads_spend`; migration 240 seeds and projects them with source
priority and audit behavior.

After release, verify one granted advertiser with each platform combination
(Shopee only, TikTok only, both), one ungranted advertiser, owner/admin input on
both platforms without grants,
and direct URL/write denial for other roles. Check workspace isolation, inactive
admin denial, stale-version rejection, and denial of edits/deletions to another
user’s entries. Confirm that creating, editing and
deleting an entry switches exactly one date/brand/platform between
`manual_marketplace` and `google_sheets` effective rows, without summing both,
and creates an audit row each time. Verify a zero manual input suppresses a
nonzero sheet fallback, a later sheet sync updates the retained fallback without
overriding manual, and deletion restores the latest sheet amount.

Local access regression checks:

```sh
node --import tsx --test tests/manual-marketplace-ad-spend.test.ts tests/advertiser-access.test.ts
node tests/manual-marketplace-spend-access-database.mjs
```

Run `npm run db:local:verify` from the primary checkout before the database test.
The test applies only migration 242 to a disposable database with minimal schema
dependencies in the local Supabase container, then removes that database. It
does not apply migrations to the shared local sample.
