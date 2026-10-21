'use client';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FunnelMetric } from '@/lib/meta-funnel-domain';
import { formatCompactMoney, formatDate, formatMetric } from '@/lib/meta-format';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

export default function MetaBrandTrend({ points, metric, currency, complete }: {
  points: { date: string; value: number | null }[]; metric: FunnelMetric; currency: string; complete: boolean;
}) {
  return <div className={styles.chartCard}>
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(date: string) => `${date.slice(8)}/${date.slice(5, 7)}`} minTickGap={24} tick={{ fill: 'var(--dim)', fontSize: 11 }} />
        <YAxis tick={{ fill: 'var(--dim)', fontSize: 11 }} tickFormatter={(v: number) => metric.format === 'percent' ? `${(v * 100).toFixed(1)}%` : formatCompactMoney(v, currency).replace('Rp ', '')} width={70} />
        <Tooltip labelFormatter={date => formatDate(String(date))} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} formatter={(value: number) => [formatMetric(value, metric, currency), metric.label]} />
        <Line type="linear" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
    {!complete && <p className={styles.muted}>Data harian belum lengkap; titik tanpa data bukan bukti performa nol.</p>}
  </div>;
}
