import { brandHighlights } from '../../lib/meta-ad-highlights';
import { defaultFunnel, emptyTotals, type SavedFunnel } from '../../lib/meta-funnel-domain';
import { assignTemplateSections, type ReportGroup } from '../../lib/meta-funnel-templates';
import type { MetaLeakSnapshotReport } from '../../lib/meta-highlight-snapshot';

export function leakFixture() {
  const group: ReportGroup = { key: 'landing:example', name: 'https://example.test/osteoporosis',
    current: { ...emptyTotals(), spend: 2246788, impressions: 100000, outbound_clicks: 1006 },
    previous: { ...emptyTotals(), spend: 2000000, impressions: 100000, outbound_clicks: 1562 },
    ad_ids: ['102', '101'], ad_names: ['Ad B', 'Ad A'], accounts: ['Example account'], landing_page_urls: ['https://example.test/osteoporosis'], verified_ad_ids: [] };
  const config: SavedFunnel = { ...defaultFunnel(), id: 'funnel-example', name: 'Example funnel', stages: ['impressions', 'outbound_clicks'], updated_at: '' };
  const { sections } = assignTemplateSections([group], [config], [{ id: 'rule-example', funnel_id: config.id, match_kind: 'domain', pattern: 'example.test' }]);
  const report: MetaLeakSnapshotReport = { workspaceId: 'workspace-example', world: 'website', brand: { id: '1', name: 'Example brand' },
    reportRange: { from: '2026-10-21', to: '2026-10-21' }, prevFrom: '2026-10-20', prevTo: '2026-10-20', reportVersion: '42',
    currency: 'IDR', reportingError: null, rulesReady: true, accounts: [{ account_id: 'act_example', account_name: 'Example account' }],
    summary: { ...group.current }, sections, highlights: [], coverageGaps: [], destinations: { missing_ads: 0, multi_ads: 0 }, objectiveUnknownAds: 0 };
  report.highlights = brandHighlights({ world: report.world, sections, summary: group.current, previous: group.previous, currency: report.currency });
  return { report, workspaceName: 'Example workspace', filters: {}, currencies: ['IDR'], generatedAt: '2026-10-22T03:00:00.000Z' };
}
