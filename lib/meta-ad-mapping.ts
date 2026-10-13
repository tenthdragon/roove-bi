import { CEP_KEYS, FUNNEL_KEYS } from './meta-ad-naming';

export const AD_MAPPING_PARSER_VERSION = 1;
export type MappingToken = { dimension: string; key: string; raw: string; position: number; source: 'bracket' | 'keyword'; recognized: boolean; label: string };
export type AdNameMapping = { parser_version: number; tags: MappingToken[]; keywords: MappingToken[]; free_text: string; issues: string[] };
export type AdMapping = {
  account_id: string; ad_id: string; ad_name: string; creative_id: string | null;
  effective_status: string | null; landing_page_urls: string[]; auto_mapping: AdNameMapping;
  campaign_id?: string | null; campaign_name?: string | null; campaign_objective?: string | null;
  overrides: { cep?: string; intention?: string }; source: 'inventory' | 'cache';
  first_seen_at: string; last_seen_at: string; revision: number;
};
export type MappingUnit = { dimension: string; unit_key: string; label: string; review_status: 'recognized' | 'new' | 'confirmed'; first_seen_at: string; last_seen_at: string };

export function normalizeMappingKey(value: string) { return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID'); }
// Explicit translations only. New vocabulary never fails parsing or gets guessed
// from a landing page. The original token is always retained beside its key.
const cepAliases: Record<string, string> = { kulit: 'skin', sendi: 'joint', tulang: 'bone', rambut: 'hair', kuku: 'nail' };
const intentionAliases: Record<string, string> = { discovery: 'disc', consideration: 'cons', conversion: 'conv' };
export function mappingUnit(dimension: string, raw: string) {
  const normalized = normalizeMappingKey(raw);
  const key = dimension === 'cep' ? cepAliases[normalized] || normalized : dimension === 'intention' ? intentionAliases[normalized] || normalized : normalized;
  const labels: Record<string, string> = dimension === 'cep' ? CEP_KEYS : dimension === 'intention' ? FUNNEL_KEYS : {};
  return { key, label: labels[key] || raw.trim(), recognized: Object.hasOwn(labels, key) };
}
export function parseAdMapping(name: string): AdNameMapping {
  const tags: MappingToken[] = []; const issues: string[] = [];
  const matches = [...name.matchAll(/\[([^\[\]]*)\]/gu)];
  const first = matches[0]?.index === name.length - name.trimStart().length;
  const second = first && matches.length > 1 && /^\s*$/u.test(name.slice((matches[0].index || 0) + matches[0][0].length, matches[1].index));
  for (const [index, match] of matches.entries()) {
    const position = index + 1;
    const dimension = first && position === 1 ? 'cep' : second && position === 2 ? 'intention' : `bracket_${position}`;
    if (!match[1].trim()) { issues.push(`Bracket ${position} kosong.`); continue; }
    const unit = mappingUnit(dimension, match[1]);
    tags.push({ dimension, raw: match[1], position, source: 'bracket', ...unit });
  }
  const freeText = name.replace(/\[([^\[\]]*)\]/gu, ' ').trim().replace(/\s+/gu, ' ');
  if (/[\[\]]/u.test(freeText)) issues.push('Ada bracket yang tidak lengkap atau bertumpuk; nama asli tetap disimpan.');
  if (!first || !second || !tags.some(t => t.dimension === 'cep') || !tags.some(t => t.dimension === 'intention')) issues.push('CEP/intention belum lengkap pada dua bracket pertama.');
  const keywords = [...new Set((freeText.match(/[\p{L}\p{N}]+(?:[-+][\p{L}\p{N}]+)*/gu) || []).map(normalizeMappingKey))]
    .map(key => ({ dimension: 'keyword', key, raw: key, label: key, position: 0, source: 'keyword' as const, recognized: false }));
  return { parser_version: AD_MAPPING_PARSER_VERSION, tags, keywords, free_text: freeText, issues };
}
export function effectiveMappingValue(ad: AdMapping, dimension: 'cep' | 'intention') {
  return ad.overrides[dimension] ?? ad.auto_mapping.tags.find(t => t.dimension === dimension)?.key ?? null;
}
export function mappingDimensionLabel(dimension: string) {
  if (dimension === 'cep') return 'CEP / bracket 1';
  if (dimension === 'intention') return 'Intention / bracket 2';
  if (dimension === 'keyword') return 'Keyword';
  return dimension.replace('bracket_', 'Bracket ');
}
