'use client';

import styles from '@/app/dashboard/meta-funnels/page.module.css';

/** Tiny trend line; gaps (null) break the line instead of dropping to zero. */
export default function MetaSparkline({ values, label }: { values: (number | null)[]; label?: string }) {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length < 2) return <svg className={styles.sparkline} viewBox="0 0 120 28" aria-hidden="true" preserveAspectRatio="none"><line x1="0" y1="14" x2="120" y2="14" stroke="var(--border)" strokeDasharray="3 3" /></svg>;
  const min = Math.min(...known), max = Math.max(...known), span = max - min || 1;
  const step = 120 / Math.max(values.length - 1, 1);
  const segments: string[] = []; let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { if (current.length) segments.push(current.join(' ')); current = []; return; }
    current.push(`${(i * step).toFixed(1)},${(26 - (v - min) / span * 24).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(' '));
  return <svg className={styles.sparkline} viewBox="0 0 120 28" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} preserveAspectRatio="none">
    {segments.map((points, i) => <polyline key={i} fill="none" stroke="var(--accent)" strokeWidth="1.5" points={points} />)}
  </svg>;
}
