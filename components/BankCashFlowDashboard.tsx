// @ts-nocheck
// components/BankCashFlowDashboard.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Session {
  id: string;
  bank: 'BCA' | 'BRI' | 'MANDIRI';
  period_label: string;
  period_start: string;
  period_end: string;
  account_no: string;
  opening_balance: number;
  closing_balance: number;
  total_credit: number;
  total_debit: number;
  transaction_count: number;
  uploaded_at: string;
}

interface DailyRow {
  date: string;
  BCA: { credit: number; debit: number };
  BRI: { credit: number; debit: number };
  MANDIRI: { credit: number; debit: number };
  total_credit: number;
  total_debit: number;
}

interface Transaction {
  transaction_date: string;
  transaction_time: string | null;
  bank: string;
  description: string;
  credit_amount: number;
  debit_amount: number;
  running_balance: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRp(n: number): string {
  if (!n && n !== 0) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function fmtFull(n: number): string {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
}

function shortDate(d: string): string {
  // "2026-04-01" → "1 Apr"
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function fmtTime(d: string, t: string | null): string {
  return t ? `${d.slice(8, 10)}/${d.slice(5, 7)} ${t}` : `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

const BANK_COLORS = { BCA: '#005BAA', BRI: '#00529B', MANDIRI: '#003087' };
const BANK_BADGES = { BCA: { bg: '#dbeafe', text: '#1e40af' }, BRI: { bg: '#dcfce7', text: '#166534' }, MANDIRI: { bg: '#fef9c3', text: '#854d0e' } };

// ── Upload Drop Zone (multi-file queue) ──────────────────────────────────────

type FileStatus = 'waiting' | 'uploading' | 'success' | 'error';
interface FileItem { file: File; status: FileStatus; message: string; }

function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const [queue, setQueue]     = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Kick off sequential processing whenever queue has waiting items
  useEffect(() => {
    if (running) return;
    const nextIdx = queue.findIndex(q => q.status === 'waiting');
    if (nextIdx < 0) return;

    setRunning(true);

    async function processNext(idx: number) {
      const item = queue[idx];
      if (!item) { setRunning(false); return; }

      // Mark as uploading
      setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'uploading', message: 'Menganalisa…' } : q));

      const form = new FormData();
      form.append('file', item.file);
      try {
        const res  = await fetch('/api/bank-csv-upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || data.error) {
          setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'error', message: data.error || 'Upload gagal' } : q));
        } else {
          setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'success', message: `${data.bank} · ${data.period_label} · ${data.inserted} transaksi` } : q));
          onUploaded(); // refresh dashboard after each success
        }
      } catch (e: any) {
        setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'error', message: e.message || 'Network error' } : q));
      }

      // Move to next waiting item
      setQueue(prev => {
        const nextWaiting = prev.findIndex((q, i) => i > idx && q.status === 'waiting');
        if (nextWaiting >= 0) {
          // Trigger next iteration — done via effect re-run after state update
        }
        return prev;
      });
      setRunning(false);
    }

    processNext(nextIdx);
  }, [queue, running]);

  function addFiles(files: FileList | File[]) {
    const newItems: FileItem[] = Array.from(files).map(f => ({ file: f, status: 'waiting', message: '' }));
    setQueue(prev => [...prev, ...newItems]);
  }

  const allDone  = queue.length > 0 && queue.every(q => q.status === 'success' || q.status === 'error');
  const anyBusy  = queue.some(q => q.status === 'uploading' || q.status === 'waiting');

  const statusIcon = (s: FileStatus) => s === 'success' ? '✓' : s === 'error' ? '✗' : s === 'uploading' ? '⟳' : '○';
  const statusColor = (s: FileStatus) => s === 'success' ? 'var(--green)' : s === 'error' ? 'var(--red)' : s === 'uploading' ? 'var(--accent)' : 'var(--dim)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 10, padding: '18px 24px', textAlign: 'center', cursor: 'pointer',
          background: dragOver ? 'var(--sidebar-active)' : 'var(--bg-deep)', transition: 'all 0.15s',
        }}
      >
        <input
          ref={inputRef} type="file" accept=".csv,.txt" multiple style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
        />
        <div style={{ fontSize: 26, marginBottom: 6 }}>☁️</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Drag & drop atau klik untuk upload</div>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3 }}>Bisa pilih banyak file sekaligus · BCA · BRI · Mandiri terdeteksi otomatis</div>
      </div>

      {/* Queue list */}
      {queue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {queue.map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              background: 'var(--bg-deep)', borderRadius: 8,
              border: `1px solid ${item.status === 'error' ? 'var(--red)' : item.status === 'success' ? 'var(--green)' : 'var(--border)'}`,
              opacity: item.status === 'waiting' ? 0.6 : 1,
            }}>
              <span style={{ color: statusColor(item.status), fontSize: 13, fontWeight: 700, flexShrink: 0, animation: item.status === 'uploading' ? 'spin 1s linear infinite' : 'none', display: 'inline-block' }}>
                {statusIcon(item.status)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</span>
              {item.message && (
                <span style={{ fontSize: 11, color: statusColor(item.status), flexShrink: 0 }}>{item.message}</span>
              )}
            </div>
          ))}

          {/* Actions row */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {allDone && (
              <button onClick={() => setQueue([])} style={{ fontSize: 11, padding: '4px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', cursor: 'pointer' }}>
                Bersihkan
              </button>
            )}
            {!anyBusy && queue.some(q => q.status === 'error') && (
              <button
                onClick={() => setQueue(prev => prev.map(q => q.status === 'error' ? { ...q, status: 'waiting', message: '' } : q))}
                style={{ fontSize: 11, padding: '4px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}
              >
                Ulangi yang Gagal
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bank Summary Card ─────────────────────────────────────────────────────────

function BankCard({ session, onDelete }: { session: Session; onDelete: () => void }) {
  const netFlow = session.total_credit - session.total_debit;
  const badge = BANK_BADGES[session.bank] || { bg: 'var(--bg-deep)', text: 'var(--text)' };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: BANK_COLORS[session.bank] || 'var(--accent)' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: badge.bg, color: badge.text, letterSpacing: '0.04em' }}>
            {session.bank}
          </span>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
            {session.account_no || '—'} · {session.transaction_count?.toLocaleString('id-ID')} transaksi
          </div>
        </div>
        <button
          onClick={onDelete}
          title="Hapus data ini"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)', fontSize: 16, lineHeight: 1, padding: 4 }}
        >×</button>
      </div>

      {/* Balance row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: 'var(--bg-deep)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Saldo Awal</div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>
            {session.opening_balance !== null ? fmtRp(session.opening_balance) : '—'}
          </div>
        </div>
        <div style={{ background: 'var(--bg-deep)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Saldo Akhir</div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>
            {session.closing_balance !== null ? fmtRp(session.closing_balance) : '—'}
          </div>
        </div>
      </div>

      {/* In / Out / Net */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cash Masuk</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)', fontFamily: 'monospace' }}>+{fmtRp(session.total_credit)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cash Keluar</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--red)', fontFamily: 'monospace' }}>-{fmtRp(session.total_debit)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Net Flow</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: netFlow >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'monospace' }}>
            {netFlow >= 0 ? '+' : ''}{fmtRp(netFlow)}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 10, textAlign: 'right' }}>
        Upload: {new Date(session.uploaded_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}

// ── Daily Bar Chart ───────────────────────────────────────────────────────────

function DailyChart({ data }: { data: DailyRow[] }) {
  if (!data.length) return null;

  const maxVal = Math.max(...data.map(d => Math.max(d.total_credit, d.total_debit)), 1);

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Cash Flow Harian (Gabungan 3 Bank)</div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11 }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--green)', marginRight: 4 }} />Cash Masuk</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--red)', marginRight: 4 }} />Cash Keluar</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, minHeight: 140, paddingBottom: 28, paddingLeft: 4, minWidth: data.length * 52 }}>
          {data.map(row => {
            const inH  = (row.total_credit / maxVal) * 120;
            const outH = (row.total_debit  / maxVal) * 120;
            return (
              <div key={row.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: '0 0 44px' }}>
                {/* Values on top */}
                {row.total_credit > 0 && (
                  <div style={{ fontSize: 8, color: 'var(--green)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtRp(row.total_credit)}</div>
                )}
                {/* Bars */}
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 120 }}>
                  <div
                    title={`Masuk: ${fmtFull(row.total_credit)}`}
                    style={{
                      width: 18, borderRadius: '3px 3px 0 0',
                      height: Math.max(inH, row.total_credit > 0 ? 2 : 0),
                      background: 'var(--green)',
                      opacity: 0.85,
                      transition: 'height 0.3s',
                      alignSelf: 'flex-end',
                    }}
                  />
                  <div
                    title={`Keluar: ${fmtFull(row.total_debit)}`}
                    style={{
                      width: 18, borderRadius: '3px 3px 0 0',
                      height: Math.max(outH, row.total_debit > 0 ? 2 : 0),
                      background: 'var(--red)',
                      opacity: 0.75,
                      transition: 'height 0.3s',
                      alignSelf: 'flex-end',
                    }}
                  />
                </div>
                {/* Date label */}
                <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', marginTop: 4 }}>{shortDate(row.date)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Transaction Table ─────────────────────────────────────────────────────────

function TransactionTable({ periodLabel }: { periodLabel: string }) {
  const [rows, setRows]       = useState<Transaction[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [bankF, setBankF]     = useState('');
  const [typeF, setTypeF]     = useState('');
  const LIMIT = 50;

  const load = useCallback(async (p = 1, b = bankF, t = typeF) => {
    setLoading(true);
    const params = new URLSearchParams({ period: periodLabel, page: String(p), limit: String(LIMIT) });
    if (b) params.set('bank', b);
    if (t) params.set('type', t);
    const res  = await fetch(`/api/bank-cashflow?${params}`);
    const data = await res.json();
    setRows(data.transactions || []);
    setTotal(data.total || 0);
    setPage(p);
    setLoading(false);
  }, [periodLabel, bankF, typeF]);

  useEffect(() => { if (periodLabel) load(1); }, [periodLabel]);

  const totalPages = Math.ceil(total / LIMIT);

  const filterBtn = (label: string, active: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, cursor: 'pointer',
        background: active ? 'var(--accent)' : 'var(--bg-deep)',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontWeight: active ? 700 : 400,
      }}
    >{label}</button>
  );

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Rincian Transaksi · {total.toLocaleString('id-ID')} baris</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Bank filter */}
          {filterBtn('Semua Bank', !bankF, () => { setBankF(''); load(1, '', typeF); })}
          {['BCA', 'BRI', 'MANDIRI'].map(b => filterBtn(b, bankF === b, () => { setBankF(b); load(1, b, typeF); }))}
          <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
          {/* Type filter */}
          {filterBtn('Semua', !typeF, () => { setTypeF(''); load(1, bankF, ''); })}
          {filterBtn('Masuk', typeF === 'CR', () => { setTypeF('CR'); load(1, bankF, 'CR'); })}
          {filterBtn('Keluar', typeF === 'DB', () => { setTypeF('DB'); load(1, bankF, 'DB'); })}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              {['Tgl/Waktu', 'Bank', 'Keterangan', 'Cash Masuk', 'Cash Keluar', 'Saldo'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Keterangan' ? 'left' : 'right', color: 'var(--dim)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', ...(h === 'Tgl/Waktu' || h === 'Bank' ? { textAlign: 'left' } : {}) }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--dim)', fontSize: 11 }}>Memuat…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--dim)', fontSize: 11 }}>Tidak ada transaksi</td></tr>
            )}
            {!loading && rows.map((r, i) => {
              const badge = BANK_BADGES[r.bank] || { bg: 'var(--bg-deep)', text: 'var(--dim)' };
              return (
                <tr key={i} style={{ borderBottom: '1px solid rgba(55,65,81,0.3)' }}>
                  <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--dim)', fontSize: 11 }}>{fmtTime(r.transaction_date, r.transaction_time)}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: badge.bg, color: badge.text }}>{r.bank}</span>
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>
                    {r.description || '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: r.credit_amount > 0 ? 'var(--green)' : 'var(--dim)', fontWeight: r.credit_amount > 0 ? 600 : 400 }}>
                    {r.credit_amount > 0 ? `+${fmtRp(r.credit_amount)}` : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: r.debit_amount > 0 ? 'var(--red)' : 'var(--dim)', fontWeight: r.debit_amount > 0 ? 600 : 400 }}>
                    {r.debit_amount > 0 ? `-${fmtRp(r.debit_amount)}` : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 11 }}>
                    {r.running_balance !== null ? fmtRp(r.running_balance) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
          <button onClick={() => load(page - 1)} disabled={page <= 1 || loading} style={pgBtn(page <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 11, color: 'var(--dim)', padding: '4px 8px', alignSelf: 'center' }}>Hal {page} / {totalPages}</span>
          <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading} style={pgBtn(page >= totalPages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

function pgBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer',
    background: 'var(--bg-deep)', color: disabled ? 'var(--dim)' : 'var(--text-secondary)', opacity: disabled ? 0.5 : 1,
  };
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function BankCashFlowDashboard() {
  const [data, setData]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [period, setPeriod]       = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleting, setDeleting]   = useState('');

  const fetchData = useCallback(async (p?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '0' });
      if (p) params.set('period', p);
      const res = await fetch(`/api/bank-cashflow?${params}`);
      const d   = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d);
      if (!p && d.currentPeriod) setPeriod(d.currentPeriod);
    } catch (e: any) {
      setError(e.message || 'Gagal memuat data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, []);

  async function handleDelete(bank: string, periodLabel: string) {
    if (!confirm(`Hapus data ${bank} · ${periodLabel}?`)) return;
    setDeleting(`${bank}-${periodLabel}`);
    await fetch(`/api/bank-cashflow?bank=${bank}&period=${encodeURIComponent(periodLabel)}`, { method: 'DELETE' });
    setDeleting('');
    fetchData(period || undefined);
  }

  const sessions: Session[] = data?.sessions || [];
  const dailyData: DailyRow[] = data?.dailyData || [];
  const periods: string[] = data?.periods || [];

  // Combined totals
  const combined = sessions.reduce((acc, s) => ({
    credit: acc.credit + (s.total_credit || 0),
    debit:  acc.debit  + (s.total_debit  || 0),
  }), { credit: 0, debit: 0 });

  const missingBanks = (['BCA', 'BRI', 'MANDIRI'] as const).filter(b => !sessions.find(s => s.bank === b));

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>💳 Cash Flow Mutasi Bank</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
            Kompilasi mutasi rekening BCA · BRI · Mandiri
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Period selector */}
          {periods.length > 0 && (
            <select
              value={period}
              onChange={e => { setPeriod(e.target.value); fetchData(e.target.value); }}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}
            >
              {periods.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <button
            onClick={() => setUploadOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: uploadOpen ? 'var(--accent)' : 'var(--card)',
              color: uploadOpen ? '#fff' : 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}
          >
            ↑ Upload CSV
          </button>
          <button
            onClick={() => fetchData(period || undefined)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--dim)', fontSize: 12, cursor: 'pointer' }}
            title="Refresh"
          >⟳</button>
        </div>
      </div>

      {/* ── Upload Panel ── */}
      {uploadOpen && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Upload Mutasi Rekening</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14 }}>
            Format bank terdeteksi otomatis. Jika file untuk periode yang sudah ada, data lama akan diganti.
          </div>
          <UploadZone onUploaded={() => { fetchData(period || undefined); }} />
          {missingBanks.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--yellow)' }}>
              ⚠ Belum ada data untuk periode ini: {missingBanks.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* ── Loading / Error ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--dim)', fontSize: 12 }}>Memuat data…</div>
      )}
      {!loading && error && (
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 8, padding: 16, color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── No data state ── */}
      {!loading && !error && sessions.length === 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Belum Ada Data</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16 }}>
            Upload file CSV mutasi rekening dari BCA, BRI, atau Mandiri untuk memulai.
          </div>
          <button
            onClick={() => setUploadOpen(true)}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
          >↑ Upload Sekarang</button>
        </div>
      )}

      {/* ── Bank Summary Cards + Combined ── */}
      {!loading && sessions.length > 0 && (
        <>
          {/* Combined summary */}
          <div style={{ background: 'var(--card)', border: '2px solid var(--accent)', borderRadius: 10, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Total Cash Masuk</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: 'var(--green)' }}>+{fmtRp(combined.credit)}</div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(combined.credit)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Total Cash Keluar</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: 'var(--red)' }}>-{fmtRp(combined.debit)}</div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(combined.debit)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Net Cash Flow</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: combined.credit - combined.debit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {combined.credit - combined.debit >= 0 ? '+' : ''}{fmtRp(combined.credit - combined.debit)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(Math.abs(combined.credit - combined.debit))}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Periode</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{period || '—'}</div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{sessions.length} bank terupload</div>
            </div>
          </div>

          {/* Per-bank cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {sessions.map(s => (
              <BankCard
                key={s.id}
                session={s}
                onDelete={() => handleDelete(s.bank, s.period_label)}
              />
            ))}
          </div>

          {/* Daily chart */}
          {dailyData.length > 0 && <DailyChart data={dailyData} />}

          {/* Transaction table */}
          <TransactionTable periodLabel={period} />
        </>
      )}
    </div>
  );
}
