'use server';

// Brand-first Meta Ads reporting: one summary per brand, one detail per brand
// and world (website or CPAS), and template rule management.
import { mutateMeta } from './meta-edit-mutations';
import { brandTemplateRules } from './meta-template-scope';
import { assertMetaBrand } from './meta-brand-access';
import { createServiceSupabase } from './service-supabase';
import { metaReportResponse } from './meta-report-requests';
import { daysBetween, emptyTotals, metricValue, relativeChange, shiftDay, sumMetricTotals, type FunnelMetric, type Totals } from './meta-funnel-domain';
import { loadTemplateRules } from './meta-funnel-store';
import { metaReportQuery, metaReportOptions, type MetaReportInput, type RawMetaReport, type ReportGroupBy } from './meta-ad-report';
import { getCachedMetaAdReport, getCachedMetaBrandOverviewReport, getCachedMetaBrandDetailReport } from './meta-ad-report-data';
import { emptyMetaBrandReport } from './meta-brand-report';
import { dimensionLabel } from './meta-ad-dimensions';
import { metaBrandAccountIds, metaBrandOptions, validateMetaBrandFilter } from './meta-ad-brands';
import { metaCoverageGaps } from './meta-report-status';
import { assignTemplateSections, compareMetrics, cpasSection, defaultLeadFunnel, matchDestinationTemplate, responseMetrics, suggestTemplate, templateKind, templateMainMetric, validateTemplateRule, WORLD_CHANNEL, type MetaBrandWorld, type MetricComparison, type ReportGroup, type TemplateRule } from './meta-funnel-templates';
import { ctwaLabel } from './meta-ctwa-destinations';
import { brandHealth, brandHighlights, type Highlight } from './meta-ad-highlights';
import { buildCepView, cepHighlights } from './meta-cep-view';
import { editAccess, reportContext, reportingAccess, uuid } from './meta-report-context';
import { defaultFunnel } from './meta-funnel-domain';
import { saveMetaFunnel } from './meta-funnel-actions';
import { getTodayWIB } from './sync-schedule';
import { metaTemplateError, metaTemplateFailure, type MetaTemplateConfiguration, type MetaTemplateResult } from './meta-template-settings';

const CPP: FunnelMetric = { id: 'cpp', label: 'CPP', numerator: 'spend', denominator: 'purchases', format: 'money', direction: 'lower', monitor: true, min_denominator: 1 };
const CPIC: FunnelMetric = { id: 'cpic', label: 'CPIC', numerator: 'spend', denominator: 'checkout', format: 'money', direction: 'lower', monitor: true, min_denominator: 1 };
const ROAS: FunnelMetric = { id: 'roas', label: 'ROAS', numerator: 'purchase_value', denominator: 'spend', format: 'multiple', direction: 'higher', monitor: true, min_denominator: 1 };
const CTR: FunnelMetric = responseMetrics('website')[1];
export type BrandInput = { from: string; to: string; filters?: MetaReportInput['filters'] };
type Context = Extract<Awaited<ReturnType<typeof reportContext>>, { schemaReady: true }>;

function validateWorld(value: unknown): MetaBrandWorld {
  if (value !== 'website' && value !== 'cpas') throw new Error('Dunia iklan tidak valid.');
  return value;
}
function normalizeGroups(raw: RawMetaReport, brands?: Context['brands']): ReportGroup[] {
  return raw.groups.map(g => ({ ...g, name: g.key.startsWith('ctwa:') && g.destination
    ? ctwaLabel(g.destination, brands?.find(b => String(b.id) === g.destination!.brand_id)?.name || 'Brand belum dipetakan')
    : g.name || g.ad_ids[0] || g.key, current: { ...emptyTotals(), ...g.current }, previous: { ...emptyTotals(), ...g.previous } }));
}
function compare(current: Totals, previous: Totals, m: FunnelMetric): MetricComparison {
  const a = metricValue(current, m), b = metricValue(previous, m);
  return { id: m.id, current: a, previous: b, change: relativeChange(a, b) };
}
const sumTotals = sumMetricTotals;
function fetchWorld(ctx: Context, world: MetaBrandWorld, brandId: string | undefined, view: 'overview' = 'overview', groupBy?: ReportGroupBy) {
  const accountIds = brandId ? metaBrandAccountIds(ctx.configuredAccounts, ctx.brands, brandId) : [];
  const config = accountIds.length ? { ...ctx.config, account_ids: accountIds } : ctx.config;
  const query = metaReportQuery({ ...ctx.input, brandId, channel: WORLD_CHANNEL[world], groupBy: groupBy || (world === 'website' ? 'landing_page' : 'ad') }, config, view);
  return getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, query);
}
function websiteWorld(ctx: Context, raw: RawMetaReport, brandAccounts: string[], rules: Awaited<ReturnType<typeof loadTemplateRules>>['rows'], brandId: string) {
  const reportingError = raw.currencies.length > 1 ? 'Brand mencakup beberapa mata uang. Pilih akun dengan mata uang yang sama.' : null;
  const summary = reportingError ? emptyTotals() : raw.summary, previous = reportingError ? emptyTotals() : raw.previous;
  const groups = reportingError ? [] : normalizeGroups(raw, ctx.brands);
  const { sections, unassigned } = assignTemplateSections(groups, ctx.funnels.filter(f => f.brand_id == null || String(f.brand_id) === brandId), brandTemplateRules(rules, brandId));
  const coverageGaps = metaCoverageGaps(raw.coverage, brandAccounts, ctx.reportRange);
  const highlights = brandHighlights({ world: 'website', sections, summary, previous, currency: raw.currencies[0] || 'IDR', unassigned, coverageGaps, missingUrls: raw.destinations.missing_ads })
    .map(h => ({ ...h, world: 'website' as const }));
  const transaction = sumTotals(sections.filter(s => s.kind === 'transaction').map(s => s.summary)), transactionPrev = sumTotals(sections.filter(s => s.kind === 'transaction').map(s => s.previous));
  return { reportingError, summary, previous, sections, unassigned, coverageGaps, highlights,
    cpp: sections.some(s => s.kind === 'transaction') ? compare(transaction, transactionPrev, CPP) : null,
    cpic: compare(summary, previous, CPIC), matchingAds: raw.matchingAds, currency: raw.currencies[0] || 'IDR' };
}
function cpasWorld(ctx: Context, raw: RawMetaReport, brandAccounts: string[]) {
  const reportingError = raw.currencies.length > 1 ? 'Brand mencakup beberapa mata uang. Pilih akun dengan mata uang yang sama.' : null;
  const summary = reportingError ? emptyTotals() : raw.summary, previous = reportingError ? emptyTotals() : raw.previous;
  const section = cpasSection(reportingError ? [] : normalizeGroups(raw), summary, previous);
  const coverageGaps = metaCoverageGaps(raw.coverage, brandAccounts, ctx.reportRange);
  const highlights = brandHighlights({ world: 'cpas', sections: [section], summary, previous, currency: raw.currencies[0] || 'IDR', coverageGaps })
    .map(h => ({ ...h, world: 'cpas' as const }));
  return { reportingError, summary, previous, section, coverageGaps, highlights, cpp: compare(summary, previous, CPP), roas: compare(summary, previous, ROAS),
    matchingAds: raw.matchingAds, currency: raw.currencies[0] || 'IDR' };
}
const rank: Record<Highlight['severity'], number> = { bad: 0, warn: 1, good: 2, info: 3 };
function mergeHighlights(...lists: (Highlight & { world: MetaBrandWorld })[][]) {
  return lists.flat().filter(h => h.kind !== 'stable').sort((a, b) => rank[a.severity] - rank[b.severity] || b.weight - a.weight);
}

export async function getMetaBrandOverview(input: BrandInput & { workspaceId?: string }) {
  return metaReportResponse(() => loadMetaBrandOverview(input));
}
async function loadMetaBrandOverview(input: BrandInput & { workspaceId?: string }) {
  const ctx = await reportContext({ from: input.from, to: input.to, filters: input.filters }, true);
  if (!ctx.schemaReady) return ctx;
  if (input.workspaceId && input.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  const [rules, report] = await Promise.all([
    loadTemplateRules(createServiceSupabase(), ctx.workspaceId),
    getCachedMetaBrandOverviewReport(ctx.workspaceId, ctx.reportVersion, ctx.reportRange.from, ctx.reportRange.to, ctx.filters, ctx.brandIds),
  ]);
  const choices = metaBrandOptions(ctx.accounts, ctx.brands, []).choices;
  const brands: {
    id: string; name: string; currency: string; adCount: number; health: ReturnType<typeof brandHealth>; reportingError: string | null;
    spend: { total: number; website: number; cpas: number; change: number | null }; ctr: MetricComparison;
    website: { cpp: MetricComparison | null; cpic: MetricComparison; templates: number; unassigned: number };
    cpas: { cpp: MetricComparison; roas: MetricComparison; ads: number } | null;
    highlights: (Highlight & { world: MetaBrandWorld })[]; dataNotes: number; summary: Totals; previous: Totals;
    cepShares: { cep: string; label: string; share: number }[];
  }[] = [];
  const worlds = new Map(report.reports.map(r => [`${r.brand}:${r.channel}`, r.report]));
  for (const brand of choices) {
    const brandAccounts = metaBrandAccountIds(ctx.accounts, ctx.brands, brand.value);
    const rawWeb = worlds.get(`${brand.value}:non_cpas`) || emptyMetaBrandReport();
    const rawCpas = worlds.get(`${brand.value}:cpas`) || emptyMetaBrandReport();
    // Multi-CEP cohorts may overlap; the denominator remains unique spend.
    const cepTotal = rawWeb.summary.spend + rawCpas.summary.spend;
    const cepShares = report.cepSpend.filter(c => c.brand === brand.value).map(c => ({ cep: c.cep,
      label: c.cep === '__unknown__' ? 'Belum terpetakan' : report.cepLabels[c.cep] || dimensionLabel('cep', c.cep),
      share: cepTotal > 0 ? c.spend / cepTotal : 0,
    })).sort((a, b) => Number(a.cep === '__unknown__') - Number(b.cep === '__unknown__') || b.share - a.share);
    const web = websiteWorld(ctx, rawWeb, brandAccounts, rules.rows, brand.value), cpas = cpasWorld(ctx, rawCpas, brandAccounts);
    const summary = sumTotals([web.summary, cpas.summary]), previous = sumTotals([web.previous, cpas.previous]);
    const highlights = mergeHighlights(web.highlights, cpas.matchingAds ? cpas.highlights : []);
    const dataNotes = highlights.filter(h => h.kind === 'data').length;
    brands.push({ id: brand.value, name: brand.label, currency: web.currency, adCount: web.matchingAds + cpas.matchingAds, health: brandHealth(highlights), summary, previous, cepShares,
      reportingError: web.reportingError || cpas.reportingError,
      spend: { total: summary.spend, website: web.summary.spend, cpas: cpas.summary.spend, change: relativeChange(summary.spend, previous.spend) },
      ctr: compare(summary, previous, CTR),
      website: { cpp: web.cpp, cpic: web.cpic, templates: web.sections.filter(s => s.groups.length).length, unassigned: web.unassigned.filter(u => u.reason === 'no_rule').length },
      cpas: cpas.matchingAds ? { cpp: cpas.cpp, roas: cpas.roas, ads: cpas.matchingAds } : null,
      highlights: highlights.slice(0, 3), dataNotes });
  }
  brands.sort((a, b) => b.spend.total - a.spend.total || a.name.localeCompare(b.name, 'id'));
  const { from, to } = ctx.reportRange;
  const summary = sumTotals(brands.map(b => b.summary)), previous = sumTotals(brands.map(b => b.previous));
  const totals = { spend: summary.spend, website: brands.reduce((s, b) => s + b.spend.website, 0), cpas: brands.reduce((s, b) => s + b.spend.cpas, 0),
    spendChange: relativeChange(summary.spend, previous.spend), ctr: compare(summary, previous, CTR) };
  const allRaw = { ...emptyMetaBrandReport(), facets: report.facets, facetTotals: report.facetTotals, cepLabels: report.cepLabels, intentionLabels: report.intentionLabels,
    currencies: [...new Set(report.reports.filter(r => r.channel === 'non_cpas').flatMap(r => r.report.currencies))].sort() };
  return { schemaReady: true as const, workspaceId: ctx.workspaceId, reportRange: ctx.reportRange, prevFrom: shiftDay(from, -daysBetween(from, to)), prevTo: shiftDay(from, -1),
    reportVersion: ctx.reportVersion, accessKey: ctx.accessKey, brandIds: ctx.brandIds, accounts: ctx.accounts, jobs: ctx.jobs, brands, totals, rulesReady: rules.ready,
    templates: ctx.funnels.map(f => ({ id: f.id, brand_id: f.brand_id, name: f.name, kind: templateKind(f) })),
    dimensionOptions: metaReportOptions(allRaw, ctx.accounts, ctx.brands).dimensionOptions, dimensionsReady: true,
    dataNotes: brands.reduce((s, b) => s + b.dataNotes, 0), currency: brands[0]?.currency || allRaw.currencies[0] || 'IDR' };
}

export async function getMetaBrandDetail(input: BrandInput & { brandId: string; world: MetaBrandWorld; workspaceId?: string }) {
  return metaReportResponse(() => loadMetaBrandDetail(input));
}
async function loadMetaBrandDetail(input: BrandInput & { brandId: string; world: MetaBrandWorld; workspaceId?: string }) {
  const world = validateWorld(input.world);
  const brandId = validateMetaBrandFilter(input.brandId);
  if (!brandId) throw new Error('Pilih brand terlebih dahulu.');
  const ctx = await reportContext({ from: input.from, to: input.to, filters: input.filters, brandId });
  if (!ctx.schemaReady) return ctx;
  if (input.workspaceId && input.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  const [rules, raw] = await Promise.all([
    loadTemplateRules(createServiceSupabase(), ctx.workspaceId),
    getCachedMetaBrandDetailReport(ctx.workspaceId, ctx.reportVersion, ctx.reportRange.from, ctx.reportRange.to, brandId, WORLD_CHANNEL[world], ctx.filters),
  ]);
  const brandAccounts = metaBrandAccountIds(ctx.accounts, ctx.brands, brandId);
  const { website: rawWeb, cpas: rawCpas, cep: rawCep } = raw;
  const web = websiteWorld(ctx, rawWeb, brandAccounts, rules.rows, brandId), cpas = cpasWorld(ctx, rawCpas, brandAccounts);
  const active = world === 'website' ? web : cpas;
  const activeRaw = world === 'website' ? rawWeb : rawCpas;
  // The CEP lens reads the same scoped ads as the destination view, cut by CEP × intention.
  const cep = buildCepView(active.reportingError ? [] : normalizeGroups(rawCep), world, active.summary, active.previous, rawCep);
  const highlights = mergeHighlights(active.highlights, cepHighlights(cep, active.currency).map(h => ({ ...h, world })));
  const { from, to } = ctx.reportRange;
  const brandOptions = metaBrandOptions(ctx.accounts, ctx.brands, []).choices.map(b => ({ value: b.value, label: b.label }));
  return { schemaReady: true as const, workspaceId: ctx.workspaceId, world, brand: { id: brandId, name: brandOptions.find(b => b.value === brandId)?.label || brandId }, brandOptions,
    reportRange: ctx.reportRange, prevFrom: shiftDay(from, -daysBetween(from, to)), prevTo: shiftDay(from, -1), reportVersion: ctx.reportVersion,
    currency: active.currency, reportingError: active.reportingError, matchingAds: active.matchingAds,
    worlds: { website: { spend: web.summary.spend, ads: web.matchingAds }, cpas: { spend: cpas.summary.spend, ads: cpas.matchingAds } },
    accounts: ctx.accounts.filter(a => brandAccounts.includes(a.account_id)).map(a => ({ account_id: a.account_id, account_name: a.account_name })),
    summary: active.summary, previous: active.previous, response: compareMetrics(active.summary, active.previous, responseMetrics(world)), responseMetrics: responseMetrics(world),
    sections: world === 'website' ? web.sections : [cpas.section], unassigned: world === 'website' ? web.unassigned : [],
    highlights, cep, coverageGaps: active.coverageGaps, destinations: activeRaw.destinations, objectiveUnknownAds: activeRaw.objectiveUnknownAds,
    dimensionOptions: metaReportOptions(activeRaw, ctx.accounts, ctx.brands).dimensionOptions, dimensionsReady: true, rulesReady: rules.ready, verifiedDestinationsReady: true,
    templates: ctx.funnels.map(f => ({ id: f.id, brand_id: f.brand_id, name: f.name, kind: templateKind(f) })) };
}

async function loadMetaTemplateSettings(requestedBrandId?: number | null) {
  const today = getTodayWIB();
  const scope = await reportingAccess();
  const brandId = requestedBrandId === undefined && scope.brandIds !== null ? scope.brandIds[0] ?? null : requestedBrandId ?? null;
  if (scope.brandIds !== null && brandId === null) throw new Error('Pilih brand yang ditugaskan.');
  if (brandId !== null) assertMetaBrand(scope, String(brandId));
  // A brand can prepare its templates before its first Meta account is connected.
  const ctx = await reportContext({ from: shiftDay(today, -30), to: shiftDay(today, -1) });
  if (!ctx.schemaReady) return ctx;
  if (ctx.workspaceId !== scope.workspaceId || brandId !== null && !ctx.brands.some(b => b.id === brandId)) throw new Error('Brand tidak tersedia dalam akses Anda.');
  const svc = createServiceSupabase();
  const [loadedRules, raw] = await Promise.all([loadTemplateRules(svc, ctx.workspaceId), fetchWorld(ctx, 'website', brandId === null ? undefined : String(brandId))]);
  const scopedRules = brandTemplateRules(loadedRules.rows, brandId);
  const matchedShared = new Set(normalizeGroups(raw, ctx.brands).map(g => matchDestinationTemplate(g, scopedRules)?.id));
  const rules = { ...loadedRules, rows: scopedRules.filter(r => ctx.brandIds === null || r.brand_id != null || matchedShared.has(r.id)) };
  ctx.funnels = ctx.funnels.filter(f => f.brand_id == null || f.brand_id === brandId);
  const accountBrand = new Map(ctx.accounts.map(a => [a.account_name, ctx.brands.find(b => b.id === a.default_brand_id)?.name || 'Brand belum dipetakan']));
  const templates = ctx.funnels.map(f => ({ ...f, kind: templateKind(f), mainMetric: templateMainMetric(f), rules: rules.rows.filter(r => r.funnel_id === f.id).length }));
  const normalized = normalizeGroups(raw, ctx.brands);
  const landingPages = normalized.filter(g => g.destination || g.landing_page_urls.length === 1).map(g => {
    const rule = matchDestinationTemplate(g, rules.rows);
    const template = rule ? ctx.funnels.find(f => f.id === rule.funnel_id) : null;
    return { key: g.key, url: g.landing_page_urls[0] || '', label: g.name, landing_page_urls: g.landing_page_urls, destination: g.destination || null,
      spend: g.current.spend, currency: (g.currencies || raw.currencies).length === 1 ? (g.currencies || raw.currencies)[0] : null, ads: g.ad_ids.length, accounts: g.accounts,
      brands: g.destination ? [ctx.brands.find(b => String(b.id) === g.destination!.brand_id)?.name || 'Brand belum dipetakan'] : [...new Set(g.accounts.map(a => accountBrand.get(a) || a))],
      evidence: { purchases: g.current.purchases, leads: g.current.leads, conversations: g.current.conversations },
      rule: rule ? { id: rule.id, match_kind: rule.match_kind, pattern: rule.pattern } : null, templateId: template?.id || null, templateName: template?.name || null,
      suggestion: suggestTemplate(g.current, ctx.funnels) };
  }).sort((a, b) => Number(!!a.templateId) - Number(!!b.templateId) || b.spend - a.spend);
  return { schemaReady: true as const, brandId, brands: ctx.brands, rulesReady: rules.ready, range: ctx.reportRange, currency: raw.currencies[0] || 'IDR', templates, accounts: ctx.accounts.filter(a => brandId === null || a.default_brand_id === brandId),
    rules: rules.rows.map(r => ({ ...r, templateName: ctx.funnels.find(f => f.id === r.funnel_id)?.name || 'Template diarsipkan' })), landingPages, reportVersion: ctx.reportVersion };
}
export async function getMetaTemplateSettings(brandId?: number | null): Promise<MetaTemplateResult<Awaited<ReturnType<typeof loadMetaTemplateSettings>>>> {
  try { return await loadMetaTemplateSettings(brandId); }
  catch (error) {
    console.error('[meta-template-settings] Load failed', error);
    return { error: metaTemplateError(error, 'Data template belum berhasil dimuat. Silakan coba muat ulang.') };
  }
}
/** Refresh configuration with the same brand scope and cached destination report. */
export async function getMetaTemplateConfiguration(brandId?: number | null): Promise<MetaTemplateResult<MetaTemplateConfiguration & { rulesReady: boolean }>> {
  try {
    const settings = await loadMetaTemplateSettings(brandId);
    if (!settings.schemaReady) throw new Error('Konfigurasi belum tersedia.');
    return { templates: settings.templates, rules: settings.rules, rulesReady: settings.rulesReady };
  } catch (error) {
    console.error('[meta-template-settings] Configuration load failed', error);
    return { error: metaTemplateError(error, 'Konfigurasi template belum berhasil dimuat. Silakan muat ulang halaman.') };
  }
}
export async function saveMetaTemplateRule(input: { id?: string; funnelId: string; match_kind: string; pattern: string }): Promise<MetaTemplateResult<TemplateRule>> {
  try {
    const ctx = await editAccess('meta:funnels');
    const rule = validateTemplateRule(input);
    uuid(input.funnelId); if (input.id) uuid(input.id);
    return await mutateMeta(ctx, 'template_rule', { ...input, ...rule }) as TemplateRule;
  } catch (error) {
    console.error('[meta-template-settings] Rule save failed', error);
    return metaTemplateFailure(error, 'Penetapan template belum dapat dikonfirmasi. Muat ulang halaman sebelum mencoba lagi.');
  }
}
export async function deleteMetaTemplateRule(id: string): Promise<MetaTemplateResult<{ deletedId: string }>> {
  try {
    const ctx = await editAccess('meta:funnels');
    await mutateMeta(ctx, 'delete_template_rule', { id: uuid(id) });
    return { deletedId: id };
  } catch (error) {
    console.error('[meta-template-settings] Rule delete failed', error);
    return metaTemplateFailure(error, 'Penghapusan aturan belum dapat dikonfirmasi. Muat ulang halaman sebelum mencoba lagi.');
  }
}
/** Creates a standard template so a workspace can start without designing one. */
export async function createMetaTemplatePreset(kind: 'transaction' | 'lead', brandId?: number | null) {
  if (kind !== 'transaction' && kind !== 'lead') throw new Error('Jenis template tidak valid.');
  const config = kind === 'transaction' ? { ...defaultFunnel(), name: 'Transaksi website', description: 'Outbound click → landing page → add to cart → initiate checkout → purchase' } : defaultLeadFunnel();
  return saveMetaFunnel({ config, brandId });
}

/** Per-ad rows behind one landing page or CPAS group, for the detail drawer. */
export async function getMetaGroupAds(input: BrandInput & { brandId: string; world: MetaBrandWorld; adIds: string[] }) {
  const world = validateWorld(input.world);
  const brandId = validateMetaBrandFilter(input.brandId);
  if (!brandId) throw new Error('Pilih brand terlebih dahulu.');
  if (!Array.isArray(input.adIds) || input.adIds.length > 5000 || input.adIds.some(id => typeof id !== 'string' || !/^\d+$/.test(id))) throw new Error('Daftar ad tidak valid.');
  const ctx = await reportContext({ from: input.from, to: input.to, filters: input.filters, brandId });
  if (!ctx.schemaReady) return ctx;
  const config = ctx.scopedAccountIds.length ? { ...ctx.config, account_ids: ctx.scopedAccountIds } : ctx.config;
  const query = metaReportQuery({ ...ctx.input, brandId, channel: WORLD_CHANNEL[world], groupBy: 'ad' }, config);
  const raw = await getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, query);
  const wanted = new Set(input.adIds);
  return { schemaReady: true as const, currency: raw.currencies[0] || 'IDR',
    ads: normalizeGroups(raw).filter(g => g.ad_ids.some(id => wanted.has(id))).sort((a, b) => b.current.spend - a.current.spend)
      .map(g => ({ key: g.key, ad_id: g.ad_ids[0], name: g.name, account: g.accounts[0] || '', current: g.current, previous: g.previous })) };
}

/** Behind one CEP: the destinations and ads carrying it, for the CEP drawer. */
export async function getMetaCepDetail(input: BrandInput & { brandId: string; world: MetaBrandWorld; cep: string }) {
  const world = validateWorld(input.world);
  const brandId = validateMetaBrandFilter(input.brandId);
  if (!brandId) throw new Error('Pilih brand terlebih dahulu.');
  if (typeof input.cep !== 'string' || !input.cep || input.cep.length > 500) throw new Error('CEP tidak valid.');
  const ctx = await reportContext({ from: input.from, to: input.to, filters: { ...input.filters, cep: input.cep }, brandId });
  if (!ctx.schemaReady) return ctx;
  const [destinations, ads] = await Promise.all([
    world === 'website' ? fetchWorld(ctx, 'website', brandId) : Promise.resolve(null),
    fetchWorld(ctx, world, brandId, 'overview', 'ad'),
  ]);
  const pick = (raw: RawMetaReport | null, limit: number) => raw ? normalizeGroups(raw, ctx.brands).sort((a, b) => b.current.spend - a.current.spend).slice(0, limit)
    .map(g => ({ key: g.key, name: g.name, ad_id: g.ad_ids[0], ads: g.ad_ids.length, accounts: g.accounts, current: g.current, previous: g.previous })) : [];
  return { schemaReady: true as const, cep: ctx.filters.cep || input.cep, currency: ads.currencies[0] || 'IDR', summary: ads.summary, previous: ads.previous,
    destinations: pick(destinations, 10), ads: pick(ads, 10), matchingAds: ads.matchingAds };
}
