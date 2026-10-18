import { matchDestinationTemplate, suggestTemplate, type TemplateKind, type TemplateRule } from './meta-funnel-templates';
import type { CtwaDestination } from './meta-ctwa-destinations';
import type { FunnelMetric, SavedFunnel } from './meta-funnel-domain';

export const META_TEMPLATE_SCHEMA_MESSAGE = 'Konfigurasi aturan template belum siap. Hubungi administrator.';
export type MetaTemplateFailure = { error: string; code?: 'TEMPLATE_SCHEMA_NOT_READY' };
export type MetaTemplateResult<T> = T | MetaTemplateFailure;

export class MetaTemplateSchemaNotReadyError extends Error {
  constructor(cause: unknown) {
    super('Pasang migration 211_meta_landing_page_templates.sql untuk menyimpan aturan template.', { cause });
    this.name = 'MetaTemplateSchemaNotReadyError';
  }
}

export function assertMetaTemplateMutation(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (['42P01', 'PGRST205'].includes(error.code || '')) throw new MetaTemplateSchemaNotReadyError(error);
  throw new Error(error.message);
}

export function metaTemplateFailure(error: unknown, fallback: string): MetaTemplateFailure {
  return error instanceof MetaTemplateSchemaNotReadyError
    ? { error: META_TEMPLATE_SCHEMA_MESSAGE, code: 'TEMPLATE_SCHEMA_NOT_READY' }
    : { error: metaTemplateError(error, fallback) };
}

export type MetaTemplateConfiguration = {
  templates: (SavedFunnel & { version: number; kind: TemplateKind; mainMetric: FunnelMetric | null; rules: number })[];
  rules: (TemplateRule & { templateName: string })[];
};
type LandingPageAssignment = {
  url: string;
  key?: string; landing_page_urls?: string[]; destination?: CtwaDestination | null;
  evidence: { purchases: number; leads: number; conversations: number };
  rule: Pick<TemplateRule, 'id' | 'match_kind' | 'pattern'> | null;
  templateId: string | null; templateName: string | null;
  suggestion: ReturnType<typeof suggestTemplate>;
};

/** Rules change assignments, not the spend or event totals already on screen. */
export function applyMetaTemplateRules<T extends MetaTemplateConfiguration & { landingPages: LandingPageAssignment[] }>(
  data: T, rules: TemplateRule[], templates = data.templates,
): T {
  return {
    ...data,
    templates: templates.map(t => ({ ...t, rules: rules.filter(r => r.funnel_id === t.id).length })),
    rules: rules.map(r => ({ ...r, templateName: templates.find(t => t.id === r.funnel_id)?.name || 'Template diarsipkan' })),
    landingPages: data.landingPages.map(lp => {
      const rule = matchDestinationTemplate(lp, rules);
      const template = templates.find(t => t.id === rule?.funnel_id);
      return { ...lp, rule: rule ? { id: rule.id, match_kind: rule.match_kind, pattern: rule.pattern } : null,
        templateId: template?.id || null, templateName: template?.name || null, suggestion: suggestTemplate(lp.evidence, templates) };
    }),
  };
}

/** Never show framework internals or database details in an action error. */
export function metaTemplateError(error: unknown, fallback: string): string {
  if (error instanceof MetaTemplateSchemaNotReadyError) return META_TEMPLATE_SCHEMA_MESSAGE;
  const message = error instanceof Error ? error.message : '';
  if (/^(Tujuan WhatsApp tidak valid\.|Jenis pencocokan tidak valid\.|Pola URL wajib diisi\.|Domain tidak valid\.|URL tidak valid\.|Template tidak ditemukan\.|Aturan tidak ditemukan\.|ID tidak valid\.|Sesi login tidak ditemukan\.)/.test(message)) return message;
  if (/statement timeout|timed? ?out|timeout/i.test(message)) return 'Server sedang sibuk. Coba lagi sebentar; data yang sudah tersimpan tetap aman.';
  return fallback;
}
