'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import {
  runScalevSourceClassBackfillAction,
  type ScalevSourceClassBackfillActionInput,
} from '@/lib/scalev-source-class-backfill-actions';
import type { ScalevSourceClassBackfillSummary } from '@/lib/scalev-source-class-backfill';

const inputStyle: CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
};

function getTodayJakartaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function ScalevSourceClassBackfillTool() {
  const [mode, setMode] = useState<'single' | 'range'>('range');
  const [date, setDate] = useState('2026-04-24');
  const [fromDate, setFromDate] = useState('2026-04-21');
  const [toDate, setToDate] = useState(getTodayJakartaDate());
  const [batchSize, setBatchSize] = useState('1000');
  const [running, setRunning] = useState<'dry_run' | 'apply' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [summary, setSummary] = useState<ScalevSourceClassBackfillSummary | null>(null);
  const [lastMode, setLastMode] = useState<'dry_run' | 'apply' | null>(null);

  const orderedDates = useMemo(
    () => Object.entries(summary?.perDate || {}).sort((left, right) => left[0].localeCompare(right[0])),
    [summary],
  );

  async function runBackfill(apply: boolean) {
    const actionMode = apply ? 'apply' : 'dry_run';
    setRunning(actionMode);
    setMessage(null);

    try {
      const input: ScalevSourceClassBackfillActionInput = {
        apply,
        batchSize: Number(batchSize || 1000) || 1000,
        fromDate: mode === 'single' ? date : fromDate,
        toDate: mode === 'single' ? date : toDate,
      };

      if (apply && !window.confirm(`Jalankan APPLY source_class untuk ${input.fromDate}${input.toDate !== input.fromDate ? ` s.d. ${input.toDate}` : ''}?`)) {
        setRunning(null);
        return;
      }

      const result = await runScalevSourceClassBackfillAction(input);
      setSummary(result);
      setLastMode(actionMode);
      setMessage({
        type: 'success',
        text: apply
          ? `Apply selesai. ${result.updated} order diperbarui.`
          : `Dry-run selesai. ${result.changed} order akan berubah.`,
      });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menjalankan backfill source_class.' });
    }

    setRunning(null);
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Temporary Source Class Backfill</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
            Tool sementara untuk mencicil formalization `source_class` di `scalev_orders`.
            Jalankan per tanggal atau rentang tanggal tanpa perlu terminal. Dry-run aman untuk audit, lalu lanjut apply saat hasilnya sudah sesuai.
          </div>
        </div>
        <div style={{ minWidth: 220, padding: '10px 12px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>Window default</div>
          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700 }}>2026-04-21 s.d. hari ini</div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 6 }}>Engine memakai classifier live yang sama, jadi hasil UI dan script akan konsisten.</div>
        </div>
      </div>

      {message ? (
        <div style={{
          padding: '8px 12px',
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 12,
          background: message.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          color: message.type === 'success' ? '#6ee7b7' : '#fca5a5',
        }}>
          {message.text}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(120px, 1fr) minmax(120px, 1fr) 120px auto auto', gap: 10, alignItems: 'end', marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 10, color: 'var(--dim)' }}>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'single' | 'range')} style={inputStyle}>
            <option value="range">Range</option>
            <option value="single">Single Day</option>
          </select>
        </div>

        {mode === 'single' ? (
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Tanggal</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>
        ) : (
          <>
            <div>
              <label style={{ fontSize: 10, color: 'var(--dim)' }}>Dari</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: 'var(--dim)' }}>Sampai</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
            </div>
          </>
        )}

        {mode === 'single' ? <div /> : null}

        <div>
          <label style={{ fontSize: 10, color: 'var(--dim)' }}>Batch</label>
          <input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} style={inputStyle} inputMode="numeric" />
        </div>

        <button
          onClick={() => runBackfill(false)}
          disabled={running !== null}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 700,
            cursor: running ? 'wait' : 'pointer',
            opacity: running ? 0.7 : 1,
          }}
        >
          {running === 'dry_run' ? 'Running...' : 'Dry-Run'}
        </button>

        <button
          onClick={() => runBackfill(true)}
          disabled={running !== null}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: 'none',
            background: '#2563eb',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            cursor: running ? 'wait' : 'pointer',
            opacity: running ? 0.7 : 1,
          }}
        >
          {running === 'apply' ? 'Applying...' : 'Apply'}
        </button>
      </div>

      {summary ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(110px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'Scanned', value: summary.scanned },
              { label: 'Created-at Window', value: summary.inCreatedAtWindow },
              { label: 'In Scope', value: summary.inScope },
              { label: 'Changed', value: summary.changed },
              { label: 'Unchanged', value: summary.unchanged },
              { label: 'Updated', value: summary.updated },
            ].map((item) => (
              <div key={item.label} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{Number(item.value || 0).toLocaleString('id-ID')}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>
            Hasil terakhir: {lastMode === 'apply' ? 'APPLY' : 'DRY-RUN'} untuk {summary.fromDate}{summary.toDate !== summary.fromDate ? ` s.d. ${summary.toDate}` : ''}.
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Tanggal', 'Rows Seen', 'In Scope', 'Changed', 'Unchanged', 'Updated'].map((header) => (
                    <th key={header} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orderedDates.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '12px 8px', color: 'var(--dim)' }}>Tidak ada tanggal yang masuk scope.</td>
                  </tr>
                ) : orderedDates.map(([day, bucket]) => (
                  <tr key={day} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--text)', fontWeight: 600 }}>{day}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{bucket.rowsSeen.toLocaleString('id-ID')}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{bucket.inScope.toLocaleString('id-ID')}</td>
                    <td style={{ padding: '6px 8px', color: '#93c5fd' }}>{bucket.changed.toLocaleString('id-ID')}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{bucket.unchanged.toLocaleString('id-ID')}</td>
                    <td style={{ padding: '6px 8px', color: '#6ee7b7' }}>{bucket.updated.toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
