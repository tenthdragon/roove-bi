// Roove Naming Convention v1.0 (February 2026). Classify only explicit Ad Name tags.
export const CEP_KEYS = { skin: 'Kesehatan Kulit', joint: 'Kesehatan Sendi', bone: 'Kesehatan Tulang', hair: 'Kesehatan Rambut', nail: 'Kesehatan Kuku' } as const;
export const FUNNEL_KEYS = { disc: 'Discovery', cons: 'Consideration', conv: 'Conversion' } as const;
export const GROUPING_OPTIONS = { landing_page: 'URL landing page', ad_id: 'Ad', ad_name: 'Ad name / creative', cep: 'CEP', funnel_stage: 'Tahap funnel', cep_funnel: 'CEP × tahap funnel' } as const;
export type CepKey = keyof typeof CEP_KEYS;
export type NamingFunnelKey = keyof typeof FUNNEL_KEYS;
export type AdGrouping = keyof typeof GROUPING_OPTIONS;
export type RooveAdName = { valid: boolean; cep: CepKey | null; funnel: NamingFunnelKey | null; creative_name: string; reason: string | null };

export function parseRooveAdName(name: string): RooveAdName {
  const text = name.trim();
  const invalid = (reason: string): RooveAdName => ({ valid: false, cep: null, funnel: null, creative_name: text, reason });
  const match = text.match(/^\[([^\]]+)\]\[([^\]]+)\]\s*(.+)$/s);
  if (!match) return invalid('Gunakan [CEP][FUNNEL] Nama Creative; bracket harus bersebelahan dan nama creative wajib diisi.');
  if (match[1] !== match[1].toLowerCase() || match[2] !== match[2].toLowerCase()) return invalid('Key dalam bracket harus huruf kecil.');
  if (!Object.hasOwn(CEP_KEYS, match[1])) return invalid('CEP tidak dikenal: pilih skin, joint, bone, hair, atau nail.');
  if (!Object.hasOwn(FUNNEL_KEYS, match[2])) return invalid('Funnel tidak dikenal: pilih disc, cons, atau conv.');
  if (!match[3].trim()) return invalid('Nama creative wajib diisi setelah kedua bracket.');
  return { valid: true, cep: match[1] as CepKey, funnel: match[2] as NamingFunnelKey, creative_name: match[3].trim(), reason: null };
}
