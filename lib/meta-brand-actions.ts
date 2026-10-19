'use server';

// Brand-first Meta Ads reporting: one summary per brand, one detail per brand
// and world (website or CPAS), and template rule management.
import { createServiceSupabase } from './service-supabase';
import { metaReportResponse } from './meta-report-requests';
import { daysBetween, emptyTotals, metricValue, relativeChange, shiftDay, sumMetricTotals, type FunnelMetric, type Totals } from './meta-funnel-domain';
import { loadFunnels, loadTemplateRules } from './meta-funnel-store';
import { metaReportQuery, metaReportOptions, type MetaReportInput, type RawMetaReport, type ReportGroupBy } from './meta-ad-report';
import { getCachedMetaAdReport, getCachedMetaBrandOverviewReport } from './meta-ad-report-data';
import { emptyMetaBrandReport } from './meta-brand-report';
import { dimensionLabel } from './meta-ad-dimensions';
import { metaBrandAccountIds, metaBrandOptions, validateMetaBrandFilter } from './meta-ad-brands';
import { metaCoverageGaps } from './meta-report-status';
import { assignTemplateSections, compareMetrics, cpasSection, defaultLeadFunnel, matchDestinationTemplate, responseMetrics, suggestTemplate, templateKind, templateMainMetric, validateTemplateRule, WORLD_CHANNEL, type MetaBrandWorld, type MetricComparison, type ReportGroup, type TemplateRule } from './meta-funnel-templates';
import { ctwaLabel } from './meta-ctwa-destinations';
import { brandHealth, brandHighlights, type Highlight } from './meta-ad-highlights';
import { buildCepView, cepHighlights } from './meta-cep-view';
import { manageAccess, reportContext, reportingAccess, uuid } from './meta-report-context';
import { defaultFunnel } from './meta-funnel-domain';
import { saveMetaFunnel } from './meta-funnel-actions';
import { getTodayWIB } from './sync-schedule';
import { assertMetaTemplateMutation, metaTemplateError, metaTemplateFailure, type MetaTemplateConfiguration, type MetaTemplateResult } from './meta-template-settings';

const CPP: FunnelMetric = { id: 'cpp', label: 'CPP', numerator: 'spend', denominator: 'purchases', format: 'money', direction: 'lower', monitor: true, min_denominator: 1 };
const CPL: FunnelMetric = { id: 'cpl', label: 'CPL', numerator: 'spend', denominator: 'leads', format: 'money', direction: 'lower', monitor: true, min_denominator: 1 };
const CPC_CONVERSATION: FunnelMetric = { ...CPL, id: 'cost_per_conversation', label: 'Biaya / conversation', denominator: 'conversations' };
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
  const query = metaReportQuery({ ...ctx.input, brandId, channel: WORLD_CHANNEL[world], groupBy: groupBy || (world === 'website' ? 'landing_page' : 'ad') }, ctx.config, view);
  return getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, query);
}
/** The lead cost metric follows whichever lead-type event the brand actually records. */
function leadCostMetric(totals: Totals): FunnelMetric { return totals.leads > 0 || totals.conversations === 0 ? CPL : CPC_CONVERSATION; }

function websiteWorld(ctx: Context, raw: RawMetaReport, brandAccounts: string[], rules: Awaited<ReturnType<typeof loadTemplateRules>>['rows']) {
  const reportingError = raw.currencies.length > 1 ? 'Brand mencakup beberapa mata uang. Pilih akun dengan mata uang yang sama.' : null;
  const summary = reportingError ? emptyTotals() : raw.summary, previous = reportingError ? emptyTotals() : raw.previous;
  const groups = reportingError ? [] : normalizeGroups(raw, ctx.brands);
  const { sections, unassigned } = assignTemplateSections(groups, ctx.funnels, rules);
  const coverageGaps = metaCoverageGaps(raw.coverage, brandAccounts, ctx.reportRange);
  const highlights = brandHighlights({ world: 'website', sections, summary, previous, currency: raw.currencies[0] || 'IDR', unassigned, coverageGaps, missingUrls: raw.destinations.missing_ads })
    .map(h => ({ ...h, world: 'website' as const }));
  const transaction = sumTotals(sections.filter(s => s.kind === 'transaction').map(s => s.summary)), transactionPrev = sumTotals(sections.filter(s => s.kind === 'transaction').map(s => s.previous));
  const lead = sumTotals(sections.filter(s => s.kind === 'lead').map(s => s.summary)), leadPrev = sumTotals(sections.filter(s => s.kind === 'lead').map(s => s.previous));
  return { reportingError, summary, previous, sections, unassigned, coverageGaps, highlights,
    cpp: sections.some(s => s.kind === 'transaction') ? compare(transaction, transactionPrev, CPP) : null,
    cpl: sections.some(s => s.kind === 'lead') ? compare(lead, leadPrev, leadCostMetric(lead)) : null,
    cplLabel: leadCostMetric(lead).label, matchingAds: raw.matchingAds, currency: raw.currencies[0] || 'IDR' };
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
    getCachedMetaBrandOverviewReport(ctx.workspaceId, ctx.reportVersion, ctx.reportRange.from, ctx.reportRange.to, ctx.filters),
  ]);
  const choices = metaBrandOptions(ctx.accounts, ctx.brands, []).choices;
  const brands: {
    id: string; name: string; currency: string; adCount: number; health: ReturnType<typeof brandHealth>; reportingError: string | null;
    spend: { total: number; website: number; cpas: number; change: number | null }; ctr: MetricComparison;
    website: { cpp: MetricComparison | null; cpl: MetricComparison | null; cplLabel: string; templates: number; unassigned: number };
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
    const web = websiteWorld(ctx, rawWeb, brandAccounts, rules.rows), cpas = cpasWorld(ctx, rawCpas, brandAccounts);
    const summary = sumTotals([web.summary, cpas.summary]), previous = sumTotals([web.previous, cpas.previous]);
    const highlights = mergeHighlights(web.highlights, cpas.matchingAds ? cpas.highlights : []);
    const dataNotes = highlights.filter(h => h.kind === 'data').length;
    brands.push({ id: brand.value, name: brand.label, currency: web.currency, adCount: web.matchingAds + cpas.matchingAds, health: brandHealth(highlights), summary, previous, cepShares,
      reportingError: web.reportingError || cpas.reportingError,
      spend: { total: summary.spend, website: web.summary.spend, cpas: cpas.summary.spend, change: relativeChange(summary.spend, previous.spend) },
      ctr: compare(summary, previous, CTR),
      website: { cpp: web.cpp, cpl: web.cpl, cplLabel: web.cplLabel, templates: web.sections.filter(s => s.groups.length).length, unassigned: web.unassigned.filter(u => u.reason === 'no_rule').length },
      cpas: cpas.matchingAds ? { cpp: cpas.cpp, roas: cpas.roas, ads: cpas.matchingAds } : null,
      highlights: highlights.slice(0, 3), dataNotes });
  }
  brands.sort((a, b) => b.spend.total - a.spend.total || a.name.localeCompare(b.name, 'id'));
  const { from, to } = ctx.reportRange;
  const summary = sumTotals(brands.map(b => b.summary)), previous = sumTotals(brands.map(b => b.previous));
  const totals = { spend: summary.spend, website: brands.reduce((s, b) => s + b.spend.website, 0), cpas: brands.reduce((s, b) => s + b.spend.cpas, 0),
    spendChange: relativeChange(summary.spend, previous.spend), ctr: compare(summary, previous, CTR) };
  const allRaw = { ...emptyMetaBrandReport(), facets: report.facets, facetTotals: report.facetTotals, cepLabels: report.cepLabels,
    currencies: [...new Set(report.reports.filter(r => r.channel === 'non_cpas').flatMap(r => r.report.currencies))].sort() };
  return { schemaReady: true as const, workspaceId: ctx.workspaceId, reportRange: ctx.reportRange, prevFrom: shiftDay(from, -daysBetween(from, to)), prevTo: shiftDay(from, -1),
    reportVersion: ctx.reportVersion, accounts: ctx.accounts, jobs: ctx.jobs, brands, totals, rulesReady: rules.ready,
    templates: ctx.funnels.map(f => ({ id: f.id, name: f.name, kind: templateKind(f) })),
    dimensionOptions: metaReportOptions(allRaw, ctx.accounts, ctx.brands).dimensionOptions, dimensionsReady: true,
    dataNotes: brands.reduce((s, b) => s + b.dataNotes, 0), currency: brands[0]?.currency || allRaw.currencies[0] || 'IDR' };
}

export async function getMetaBrandDetail(input: BrandInput & { brandId: string; world: MetaBrandWorld }) {
  return metaReportResponse(() => loadMetaBrandDetail(input));
}
async function loadMetaBrandDetail(input: BrandInput & { brandId: string; world: MetaBrandWorld }) {
  const world = validateWorld(input.world);
  const brandId = validateMetaBrandFilter(input.brandId);
  if (!brandId) throw new Error('Pilih brand terlebih dahulu.');
  const ctx = await reportContext({ from: input.from, to: input.to, filters: input.filters, brandId });
  if (!ctx.schemaReady) return ctx;
  const rules = await loadTemplateRules(createServiceSupabase(), ctx.workspaceId);
  const brandAccounts = metaBrandAccountIds(ctx.accounts, ctx.brands, brandId);
  const [rawWeb, rawCpas, rawCep] = await Promise.all([fetchWorld(ctx, 'website', brandId), fetchWorld(ctx, 'cpas', brandId), fetchWorld(ctx, world, brandId, 'overview', 'cep_intention')]);
  const web = websiteWorld(ctx, rawWeb, brandAccounts, rules.rows), cpas = cpasWorld(ctx, rawCpas, brandAccounts);
  const active = world === 'website' ? web : cpas;
  const raw = world === 'website' ? rawWeb : rawCpas;
  // The CEP lens reads the same scoped ads as the destination view, cut by CEP × intention.
  const cep = buildCepView(active.reportingError ? [] : normalizeGroups(rawCep), world, active.summary, active.previous, rawCep);
  const highlights = mergeHighlights(active.highlights, cepHighlights(cep, active.currency).map(h => ({ ...h, world })));
  if (!highlights.some(h => h.severity === 'bad' || (h.severity === 'warn' && h.kind !== 'data'))) highlights.unshift({ kind: 'stable', severity: 'info', title: 'Stabil', weight: 0, world, text: 'Tidak ada sinyal penurunan atau pencilan biaya pada periode ini.' });
  const { from, to } = ctx.reportRange;
  const brandOptions = metaBrandOptions(ctx.accounts, ctx.brands, []).choices.map(b => ({ value: b.value, label: b.label }));
  return { schemaReady: true as const, world, brand: { id: brandId, name: brandOptions.find(b => b.value === brandId)?.label || brandId }, brandOptions,
    reportRange: ctx.reportRange, prevFrom: shiftDay(from, -daysBetween(from, to)), prevTo: shiftDay(from, -1), reportVersion: ctx.reportVersion,
    currency: active.currency, reportingError: active.reportingError, matchingAds: active.matchingAds,
    worlds: { website: { spend: web.summary.spend, ads: web.matchingAds }, cpas: { spend: cpas.summary.spend, ads: cpas.matchingAds } },
    accounts: ctx.accounts.filter(a => brandAccounts.includes(a.account_id)).map(a => ({ account_id: a.account_id, account_name: a.account_name })),
    summary: active.summary, previous: active.previous, response: compareMetrics(active.summary, active.previous, responseMetrics(world)), responseMetrics: responseMetrics(world),
    sections: world === 'website' ? web.sections : [cpas.section], unassigned: world === 'website' ? web.unassigned : [],
    highlights: highlights.slice(0, 6), cep, coverageGaps: active.coverageGaps, destinations: raw.destinations, objectiveUnknownAds: raw.objectiveUnknownAds,
    dimensionOptions: metaReportOptions(raw, ctx.accounts, ctx.brands).dimensionOptions, dimensionsReady: true, rulesReady: rules.ready, verifiedDestinationsReady: true,
    templates: ctx.funnels.map(f => ({ id: f.id, name: f.name, kind: templateKind(f) })) };
}

async function loadMetaTemplateSettings() {
  const today = getTodayWIB();
  const ctx = await reportContext({ from: shiftDay(today, -30), to: shiftDay(today, -1) });
  if (!ctx.schemaReady) return ctx;
  const svc = createServiceSupabase();
  const [rules, raw] = await Promise.all([loadTemplateRules(svc, ctx.workspaceId), fetchWorld(ctx, 'website', undefined)]);
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
  return { schemaReady: true as const, rulesReady: rules.ready, range: ctx.reportRange, currency: raw.currencies[0] || 'IDR', templates, accounts: ctx.accounts,
    rules: rules.rows.map(r => ({ ...r, templateName: ctx.funnels.find(f => f.id === r.funnel_id)?.name || 'Template diarsipkan' })), landingPages, reportVersion: ctx.reportVersion };
}
export async function getMetaTemplateSettings(): Promise<MetaTemplateResult<Awaited<ReturnType<typeof loadMetaTemplateSettings>>>> {
  try { return await loadMetaTemplateSettings(); }
  catch (error) {
    console.error('[meta-template-settings] Load failed', error);
    return { error: metaTemplateError(error, 'Data template belum berhasil dimuat. Silakan coba muat ulang.') };
  }
}
/** Refresh configuration after edits without rereading the performance report. */
export async function getMetaTemplateConfiguration(): Promise<MetaTemplateResult<MetaTemplateConfiguration & { rulesReady: boolean }>> {
  try {
    const { workspaceId } = await reportingAccess();
    const svc = createServiceSupabase();
    const [funnels, rules] = await Promise.all([loadFunnels(svc, workspaceId), loadTemplateRules(svc, workspaceId)]);
    return { rulesReady: rules.ready,
      templates: funnels.filter(f => f.group_by === 'landing_page').map(f => ({ ...f, kind: templateKind(f), mainMetric: templateMainMetric(f), rules: rules.rows.filter(r => r.funnel_id === f.id).length })),
      rules: rules.rows.map(r => ({ ...r, templateName: funnels.find(f => f.id === r.funnel_id)?.name || 'Template diarsipkan' })) };
  } catch (error) {
    console.error('[meta-template-settings] Configuration load failed', error);
    return { error: metaTemplateError(error, 'Konfigurasi template belum berhasil dimuat. Silakan muat ulang halaman.') };
  }
}
export async function saveMetaTemplateRule(input: { id?: string; funnelId: string; match_kind: string; pattern: string }): Promise<MetaTemplateResult<TemplateRule>> {
  try {
    const { workspaceId, profile } = await manageAccess();
    const rule = validateTemplateRule(input);
    const svc = createServiceSupabase();
    if (rule.match_kind === 'ctwa') {
      const brandId = rule.pattern.split(':')[1];
      if (brandId !== '__unmapped__') {
        const brand = await svc.from('brands').select('id').eq('workspace_id', workspaceId).eq('id', brandId).maybeSingle();
        if (brand.error) throw new Error(brand.error.message);
        if (!brand.data) throw new Error('Tujuan WhatsApp tidak valid. Brand tidak ditemukan.');
      }
    }
    const funnel = await svc.from('meta_ad_funnels').select('id').eq('workspace_id', workspaceId).eq('id', uuid(input.funnelId)).eq('archived', false).maybeSingle();
    if (funnel.error) throw new Error(funnel.error.message);
    if (!funnel.data) throw new Error('Template tidak ditemukan.');
    const row = { workspace_id: workspaceId, funnel_id: input.funnelId, ...rule, updated_at: new Date().toISOString() };
    const result = input.id
      ? await svc.from('meta_landing_page_templates').update(row).eq('workspace_id', workspaceId).eq('id', uuid(input.id)).select('id').maybeSingle()
      : await svc.from('meta_landing_page_templates').upsert({ ...row, created_by: profile.id }, { onConflict: 'workspace_id,match_kind,pattern' }).select('id').maybeSingle();
    assertMetaTemplateMutation(result.error);
    if (!result.data) throw new Error('Aturan tidak ditemukan.');
    return { id: result.data.id as string, funnel_id: input.funnelId, ...rule };
  } catch (error) {
    console.error('[meta-template-settings] Rule save failed', error);
    return metaTemplateFailure(error, 'Penetapan template belum dapat dikonfirmasi. Muat ulang halaman sebelum mencoba lagi.');
  }
}
export async function deleteMetaTemplateRule(id: string): Promise<MetaTemplateResult<{ deletedId: string }>> {
  try {
    const { workspaceId } = await manageAccess();
    const result = await createServiceSupabase().from('meta_landing_page_templates').delete().eq('workspace_id', workspaceId).eq('id', uuid(id));
    assertMetaTemplateMutation(result.error);
    return { deletedId: id };
  } catch (error) {
    console.error('[meta-template-settings] Rule delete failed', error);
    return metaTemplateFailure(error, 'Penghapusan aturan belum dapat dikonfirmasi. Muat ulang halaman sebelum mencoba lagi.');
  }
}
/** Creates a standard template so a workspace can start without designing one. */
export async function createMetaTemplatePreset(kind: 'transaction' | 'lead') {
  if (kind !== 'transaction' && kind !== 'lead') throw new Error('Jenis template tidak valid.');
  const config = kind === 'transaction' ? { ...defaultFunnel(), name: 'Transaksi website', description: 'Outbound click → landing page → add to cart → initiate checkout → purchase' } : defaultLeadFunnel();
  return saveMetaFunnel({ config });
}

/** Per-ad rows behind one landing page or CPAS group, for the detail drawer. */
export async function getMetaGroupAds(input: BrandInput & { brandId: string; world: MetaBrandWorld; adIds: string[] }) {
  const world = validateWorld(input.world);
  const brandId = validateMetaBrandFilter(input.brandId);
  if (!brandId) throw new Error('Pilih brand terlebih dahulu.');
  if (!Array.isArray(input.adIds) || input.adIds.length > 5000 || input.adIds.some(id => typeof id !== 'string' || !/^\d+$/.test(id))) throw new Error('Daftar ad tidak valid.');
  const ctx = await reportContext({ from: input.from, to: input.to, filters: input.filters, brandId });
  if (!ctx.schemaReady) return ctx;
  const query = metaReportQuery({ ...ctx.input, brandId, channel: WORLD_CHANNEL[world], groupBy: 'ad' }, ctx.config);
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
