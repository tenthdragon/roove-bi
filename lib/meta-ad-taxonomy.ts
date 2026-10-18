import { mappingUnit, type AdNameMapping } from './meta-ad-mapping';
import { CEP_KEYS, FUNNEL_KEYS } from './meta-ad-naming';
export const INTENTIONS = FUNNEL_KEYS;
export type CepCategory = { brand_id: number; key: string; label: string; description: string; revision: number; is_active?: boolean };
export type TaxonomyRule = { brand_id: number; dimension: 'cep' | 'intention'; raw_key: string; cep_keys: string[]; intention_key: string | null; revision: number };
export type MappingOverrides = { cep?: string; ceps?: string[]; intention?: string };
export type Classification = { cep_keys: string[]; intention_key: string | null; cep_source: string; intention_source: string };
export function resolveTaxonomy(brandId: number | null, auto: AdNameMapping, overrides: MappingOverrides, catalog: CepCategory[], rules: TaxonomyRule[] = []): Classification {
  const own = catalog.filter(c => c.brand_id === brandId);
  const raw = (d: string) => auto.tags.find(t => t.dimension === d)?.key || '';
  const resolve = (d: 'cep' | 'intention') => {
    const manual = d === 'cep' ? overrides.ceps !== undefined || overrides.cep !== undefined : overrides.intention !== undefined;
    const token = d === 'cep' ? overrides.cep ?? raw(d) : overrides.intention ?? raw(d);
    const key = mappingUnit(d, token).key;
    const rule = !manual ? rules.find(r => r.brand_id === brandId && r.dimension === d && r.raw_key === key) : undefined;
    const source = manual ? 'manual' : rule ? 'rule' : 'naming';
    if (d === 'cep') {
      const candidates = overrides.ceps ?? (rule ? rule.cep_keys : [key]);
      const keys = candidates.map(k => own.find(c => c.key === k || c.key === `b${brandId}.${k}`)?.key).filter((k): k is string => !!k);
      return { keys: [...new Set(keys)].sort(), source };
    }
    const intention = rule?.intention_key ?? key;
    return { intention: Object.hasOwn(INTENTIONS, intention) ? intention : null, source };
  };
  const cep = resolve('cep'), intention = resolve('intention');
  return { cep_keys: cep.keys || [], intention_key: intention.intention || null, cep_source: cep.source, intention_source: intention.source };
}
export function validateIntention(value: string): string {
  const key = mappingUnit('intention', value).key;
  if (!Object.hasOwn(INTENTIONS, key)) throw new Error('Intention harus Discovery, Consideration, atau Conversion.');
  return key;
}
export function validateCepSelection(values: unknown, brandId: number, catalog: CepCategory[], retained: string[] = []): string[] {
  if (!Array.isArray(values) || values.length > 50 || values.some(v => typeof v !== 'string')) throw new Error('Pilihan CEP tidak valid.');
  const result = [...new Set(values as string[])].sort();
  if (result.length !== values.length || result.some(key => !catalog.some(c => c.brand_id === brandId && c.key === key && (c.is_active !== false || retained.includes(key))))) throw new Error('Pilih CEP resmi milik brand iklan.');
  return result;
}

/** Names stay editable; the stable, brand-owned identity is created only once. */
export function newCepKey(brandId: number, label: string): string {
  const slug = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!Number.isInteger(brandId) || brandId <= 0 || !slug) throw new Error('Nama CEP harus mengandung huruf atau angka.');
  // Avoid colliding with the unprefixed legacy Roove identities during naming resolution.
  const localKey = Object.hasOwn(CEP_KEYS, slug) ? `cep-${slug}` : slug;
  return `b${brandId}.${localKey}`.slice(0, 80);
}
