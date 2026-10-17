'use client';

import styles from '@/app/dashboard/meta-funnels/page.module.css';

import type { MetaAdChannel } from '@/lib/meta-ad-channels';

type Props = {
  value: MetaAdChannel;
  counts?: Partial<Record<MetaAdChannel, number>>;
  onChange: (value: MetaAdChannel) => void;
  loading?: boolean;
};

const choices: Array<{ value: MetaAdChannel; label: string; description: string }> = [
  { value: 'non_cpas', label: 'Non-CPAS', description: 'Tanpa tujuan atau katalog Shopee.' },
  { value: 'cpas', label: 'CPAS', description: 'Tujuan atau katalog Shopee.' },
  { value: 'unknown', label: 'Perlu verifikasi', description: 'Data tujuan belum lengkap atau belum terverifikasi.' },
];

const numberFormat = new Intl.NumberFormat('id-ID');

export default function MetaAdChannelPicker({ value, counts = {}, onChange, loading = false }: Props) {
  return <div role="group" aria-label="Jenis iklan" className={styles.channelPicker}>
    {choices.map(choice => {
      const active = value === choice.value;
      const count = counts[choice.value];
      return <button
        key={choice.value}
        type="button"
        aria-pressed={active}
        disabled={loading}
        className={`${styles.channelChoice} ${active ? styles.channelChoiceActive : ''}`.trim()}
        onClick={() => onChange(choice.value)}
      >
        <span className={styles.channelLabel}>{choice.label}</span>
        {count !== undefined && Number.isFinite(count) && <span className={styles.channelCount}>{numberFormat.format(count)}</span>}
        <span className={styles.channelDescription}>{choice.description}</span>
      </button>;
    })}
  </div>;
}
