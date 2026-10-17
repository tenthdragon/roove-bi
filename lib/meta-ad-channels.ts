export const META_AD_CHANNELS = ['non_cpas', 'cpas', 'unknown'] as const;
export type MetaAdChannel = typeof META_AD_CHANNELS[number];

export function validateMetaAdChannel(value: unknown = 'non_cpas'): MetaAdChannel {
  if (typeof value !== 'string' || !META_AD_CHANNELS.includes(value as MetaAdChannel)) throw new Error('Jenis iklan tidak valid.');
  return value as MetaAdChannel;
}
export function metaAdChannelLabel(value: MetaAdChannel): string {
  return { non_cpas: 'Non-CPAS', cpas: 'CPAS', unknown: 'Perlu verifikasi' }[value];
}
export function metaAdChannelCounts(counts?: Partial<Record<MetaAdChannel, number>>): Record<MetaAdChannel, number> {
  return Object.fromEntries(META_AD_CHANNELS.map(channel => [channel, counts?.[channel] || 0])) as Record<MetaAdChannel, number>;
}
