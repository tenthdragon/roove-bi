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
  id: string;
  transaction_date: string;
  transaction_time: string | null;
  bank: string;
  account_no: string;
  description: string;
  credit_amount: number;
  debit_amount: number;
  running_balance: number | null;
  tag: string;
  tag_auto: string;
}

// Tag definitions
const ALL_TAGS = ['customer', 'supplier', 'intercompany', 'operasional', 'biaya_bank', 'marketplace', 'refund', 'auto_debit', 'n/a'] as const;
const TAG_LABELS: Record<string, string> = {
  customer: 'Customer', supplier: 'Supplier', intercompany: 'Intercompany',
  operasional: 'Operasional', biaya_bank: 'Biaya Bank', marketplace: 'Marketplace',
  refund: 'Refund', auto_debit: 'Auto Debit', 'n/a': 'N/A',
};
const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  customer:     { bg: '#dcfce7', text: '#166534' },
  supplier:     { bg: '#fed7aa', text: '#9a3412' },
  intercompany: { bg: '#dbeafe', text: '#1e40af' },
  operasional:  { bg: '#fef9c3', text: '#854d0e' },
  biaya_bank:   { bg: '#f3e8ff', text: '#6b21a8' },
  marketplace:  { bg: '#cffafe', text: '#155e75' },
  refund:       { bg: '#ffe4e6', text: '#9f1239' },
  auto_debit:   { bg: '#fce7f3', text: '#9d174d' },
  'n/a':        { bg: '#f1f5f9', text: '#64748b' },
};

interface BankAccount {
  id: string;
  bank: string;
  account_no: string;
  account_name: string;
  business_name: string;
  is_active: boolean;
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
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function fmtTime(d: string, t: string | null): string {
  return t ? `${d.slice(8, 10)}/${d.slice(5, 7)} ${t}` : `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

const BANK_COLORS: Record<string, string> = { BCA: '#005BAA', BRI: '#00529B', MANDIRI: '#003087' };
const BANK_BADGES: Record<string, { bg: string; text: string }> = {
  BCA: { bg: '#dbeafe', text: '#1e40af' },
  BRI: { bg: '#dcfce7', text: '#166534' },
  MANDIRI: { bg: '#fef9c3', text: '#854d0e' },
};

const BIZ_COLORS: Record<string, string> = {
  RTI: '#3b82f6', RLT: '#8b5cf6', RLB: '#06b6d4', JHN: '#f97316',
};

// ── Upload Drop Zone (multi-file queue) ──────────────────────────────────────

type FileStatus = 'waiting' | 'uploading' | 'success' | 'error';
interface FileItem { file: File; status: FileStatus; message: string; }

function UploadZone({ onUploaded }: { onUploaded: () => void }) {
  const [queue, setQueue]     = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (running) return;
    const nextIdx = queue.findIndex(q => q.status === 'waiting');
    if (nextIdx < 0) return;

    setRunning(true);

    async function processNext(idx: number) {
      const item = queue[idx];
      if (!item) { setRunning(false); return; }

      setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'uploading', message: 'Menganalisa…' } : q));

      const form = new FormData();
      form.append('file', item.file);
      try {
        const res  = await fetch('/api/bank-csv-upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || data.error) {
          setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'error', message: data.error || 'Upload gagal' } : q));
        } else {
          const acctShort = data.account_no ? `${data.account_no.slice(-4)}` : '';
          setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'success', message: `${data.bank}${acctShort ? ` ****${acctShort}` : ''} · ${data.period_label} · ${data.inserted} transaksi` } : q));
          onUploaded();
        }
      } catch (e: any) {
        setQueue(prev => prev.map((q, i) => i === idx ? { ...q, status: 'error', message: e.message || 'Network error' } : q));
      }

      setQueue(prev => {
        const nextWaiting = prev.findIndex((q, i) => i > idx && q.status === 'waiting');
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

// ── Business Table (compact) ─────────────────────────────────────────────────

function BizTable({ sessions, bizName, onDelete }: { sessions: Session[]; bizName: string; onDelete: (s: Session) => void }) {
  const totals = sessions.reduce((acc, s) => ({
    opening: acc.opening + (s.opening_balance || 0),
    closing: acc.closing + (s.closing_balance || 0),
    credit:  acc.credit  + (s.total_credit || 0),
    debit:   acc.debit   + (s.total_debit  || 0),
    trx:     acc.trx     + (s.transaction_count || 0),
  }), { opening: 0, closing: 0, credit: 0, debit: 0, trx: 0 });
  const netTotal = totals.credit - totals.debit;

  const thStyle: React.CSSProperties = { padding: '6px 10px', fontSize: 10, fontWeight: 600, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', textAlign: 'right' };
  const tdStyle: React.CSSProperties = { padding: '5px 10px', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap', textAlign: 'right' };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
      {/* Color bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: BIZ_COLORS[bizName] || 'var(--accent)' }} />

      {/* Title */}
      <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: BIZ_COLORS[bizName] || '#64748b', color: '#fff' }}>{bizName}</span>
        <span style={{ fontSize: 11, color: 'var(--dim)' }}>{totals.trx.toLocaleString('id-ID')} transaksi</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ ...thStyle, textAlign: 'left' }}>Bank</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Rekening</th>
              <th style={thStyle}>Saldo Awal</th>
              <th style={thStyle}>Saldo Akhir</th>
              <th style={thStyle}>Cash Masuk</th>
              <th style={thStyle}>Cash Keluar</th>
              <th style={thStyle}>Net Flow</th>
              <th style={{ ...thStyle, width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => {
              const net = s.total_credit - s.total_debit;
              const badge = BANK_BADGES[s.bank] || { bg: 'var(--bg-deep)', text: 'var(--dim)' };
              return (
                <tr key={s.id} style={{ borderBottom: '1px solid rgba(55,65,81,0.2)' }}>
                  <td style={{ ...tdStyle, textAlign: 'left', fontFamily: 'inherit' }}>
                    <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: badge.bg, color: badge.text }}>{s.bank}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {s.account_no && s.account_no !== 'UNKNOWN' ? s.account_no : '—'}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.opening_balance != null ? fmtRp(s.opening_balance) : '—'}</td>
                  <td style={{ ...tdStyle, color: 'var(--text)' }}>{s.closing_balance != null ? fmtRp(s.closing_balance) : '—'}</td>
                  <td style={{ ...tdStyle, color: 'var(--green)' }}>+{fmtRp(s.total_credit)}</td>
                  <td style={{ ...tdStyle, color: 'var(--red)' }}>-{fmtRp(s.total_debit)}</td>
                  <td style={{ ...tdStyle, color: net >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{net >= 0 ? '+' : ''}{fmtRp(net)}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button onClick={() => onDelete(s)} title="Hapus" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)', fontSize: 13, padding: 2, lineHeight: 1, opacity: 0.6 }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Subtotal row */}
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-deep)' }}>
              <td colSpan={2} style={{ ...tdStyle, textAlign: 'left', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>TOTAL {bizName}</td>
              <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--text)' }}>{fmtRp(totals.opening)}</td>
              <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--text)' }}>{fmtRp(totals.closing)}</td>
              <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--green)' }}>+{fmtRp(totals.credit)}</td>
              <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--red)' }}>-{fmtRp(totals.debit)}</td>
              <td style={{ ...tdStyle, fontWeight: 700, color: netTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{netTotal >= 0 ? '+' : ''}{fmtRp(netTotal)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
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
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Cash Flow Harian</div>

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
                {row.total_credit > 0 && (
                  <div style={{ fontSize: 8, color: 'var(--green)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{fmtRp(row.total_credit)}</div>
                )}
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 120 }}>
                  <div
                    title={`Masuk: ${fmtFull(row.total_credit)}`}
                    style={{
                      width: 18, borderRadius: '3px 3px 0 0',
                      height: Math.max(inH, row.total_credit > 0 ? 2 : 0),
                      background: 'var(--green)', opacity: 0.85, transition: 'height 0.3s', alignSelf: 'flex-end',
                    }}
                  />
                  <div
                    title={`Keluar: ${fmtFull(row.total_debit)}`}
                    style={{
                      width: 18, borderRadius: '3px 3px 0 0',
                      height: Math.max(outH, row.total_debit > 0 ? 2 : 0),
                      background: 'var(--red)', opacity: 0.75, transition: 'height 0.3s', alignSelf: 'flex-end',
                    }}
                  />
                </div>
                <div style={{ fontSize: 9, color: 'var(--dim)', whiteSpace: 'nowrap', marginTop: 4 }}>{shortDate(row.date)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Tag Pill (clickable with dropdown) ───────────────────────────────────────

function TagPill({ tag, tagAuto, onChangeTag }: { tag: string; tagAuto: string; onChangeTag: (newTag: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isOverridden = tag !== tagAuto;
  const colors = TAG_COLORS[tag] || TAG_COLORS['n/a'];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
          background: colors.bg, color: colors.text, border: 'none', cursor: 'pointer',
          outline: open ? `2px solid ${colors.text}` : 'none',
        }}
      >
        {isOverridden && <span title={`Auto: ${TAG_LABELS[tagAuto] || tagAuto}`} style={{ fontSize: 8, opacity: 0.7 }}>*</span>}
        {TAG_LABELS[tag] || tag}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', padding: 4, minWidth: 130,
        }}>
          {ALL_TAGS.map(t => {
            const tc = TAG_COLORS[t] || TAG_COLORS['n/a'];
            return (
              <button
                key={t}
                onClick={() => { onChangeTag(t); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '5px 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
                  background: tag === t ? 'var(--sidebar-active)' : 'transparent',
                  fontSize: 11, color: 'var(--text)', textAlign: 'left',
                }}
              >
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: tc.bg, border: `1px solid ${tc.text}`, flexShrink: 0 }} />
                {TAG_LABELS[t]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Transaction Table ─────────────────────────────────────────────────────────

function TransactionTable({ periodLabel, business, acctMap }: { periodLabel: string; business: string; acctMap: Record<string, string> }) {
  const [rows, setRows]       = useState<Transaction[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [bankF, setBankF]     = useState('');
  const [typeF, setTypeF]     = useState('');
  const [tagF, setTagF]       = useState('');
  const LIMIT = 50;

  const load = useCallback(async (p = 1, b = bankF, t = typeF, tg = tagF) => {
    setLoading(true);
    const params = new URLSearchParams({ period: periodLabel, page: String(p), limit: String(LIMIT) });
    if (b) params.set('bank', b);
    if (t) params.set('type', t);
    if (tg) params.set('tag', tg);
    if (business) params.set('business', business);
    const res  = await fetch(`/api/bank-cashflow?${params}`);
    const data = await res.json();
    setRows(data.transactions || []);
    setTotal(data.total || 0);
    setPage(p);
    setLoading(false);
  }, [periodLabel, bankF, typeF, tagF, business]);

  useEffect(() => { if (periodLabel) load(1); }, [periodLabel, business]);

  async function updateTag(txnId: string, newTag: string) {
    // Optimistic update
    setRows(prev => prev.map(r => r.id === txnId ? { ...r, tag: newTag } : r));
    await fetch('/api/bank-transactions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: txnId, tag: newTag }),
    });
  }

  const totalPages = Math.ceil(total / LIMIT);

  const filterBtn = (label: string, active: boolean, onClick: () => void, color?: string) => (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 10, cursor: 'pointer',
        background: active ? (color || 'var(--accent)') : 'var(--bg-deep)',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontWeight: active ? 700 : 400,
      }}
    >{label}</button>
  );

  const COLS = 8;

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      {/* Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Rincian Transaksi · {total.toLocaleString('id-ID')} baris</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {filterBtn('Semua Bank', !bankF, () => { setBankF(''); load(1, '', typeF, tagF); })}
          {['BCA', 'BRI', 'MANDIRI'].map(b => filterBtn(b, bankF === b, () => { setBankF(b); load(1, b, typeF, tagF); }))}
          <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
          {filterBtn('Semua', !typeF, () => { setTypeF(''); load(1, bankF, '', tagF); })}
          {filterBtn('Masuk', typeF === 'CR', () => { setTypeF('CR'); load(1, bankF, 'CR', tagF); })}
          {filterBtn('Keluar', typeF === 'DB', () => { setTypeF('DB'); load(1, bankF, 'DB', tagF); })}
        </div>
      </div>

      {/* Tag filter row */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: 'var(--dim)', alignSelf: 'center', marginRight: 2 }}>Tag:</span>
        {filterBtn('Semua', !tagF, () => { setTagF(''); load(1, bankF, typeF, ''); })}
        {ALL_TAGS.filter(t => t !== 'n/a').map(t => {
          const tc = TAG_COLORS[t];
          return filterBtn(TAG_LABELS[t], tagF === t, () => { setTagF(t); load(1, bankF, typeF, t); }, tc.text);
        })}
        {filterBtn('N/A', tagF === 'n/a', () => { setTagF('n/a'); load(1, bankF, typeF, 'n/a'); })}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              {['Tgl/Waktu', 'Bisnis', 'Bank', 'Keterangan', 'Tag', 'Cash Masuk', 'Cash Keluar', 'Saldo'].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: ['Keterangan', 'Tgl/Waktu', 'Bisnis', 'Bank', 'Tag'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={COLS} style={{ textAlign: 'center', padding: 20, color: 'var(--dim)', fontSize: 11 }}>Memuat…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={COLS} style={{ textAlign: 'center', padding: 20, color: 'var(--dim)', fontSize: 11 }}>Tidak ada transaksi</td></tr>
            )}
            {!loading && rows.map((r) => {
              const badge = BANK_BADGES[r.bank] || { bg: 'var(--bg-deep)', text: 'var(--dim)' };
              const biz = acctMap[r.account_no] || '';
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid rgba(55,65,81,0.3)' }}>
                  <td style={{ padding: '5px 8px', whiteSpace: 'nowrap', color: 'var(--dim)', fontSize: 11 }}>{fmtTime(r.transaction_date, r.transaction_time)}</td>
                  <td style={{ padding: '5px 8px' }}>
                    {biz ? (
                      <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: BIZ_COLORS[biz] || 'var(--accent)', color: '#fff' }}>{biz}</span>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--dim)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: badge.bg, color: badge.text }}>{r.bank}</span>
                  </td>
                  <td style={{ padding: '5px 8px', color: 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>
                    {r.description || '—'}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <TagPill tag={r.tag || 'n/a'} tagAuto={r.tag_auto || 'n/a'} onChangeTag={(t) => updateTag(r.id, t)} />
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: r.credit_amount > 0 ? 'var(--green)' : 'var(--dim)', fontWeight: r.credit_amount > 0 ? 600 : 400 }}>
                    {r.credit_amount > 0 ? `+${fmtRp(r.credit_amount)}` : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: r.debit_amount > 0 ? 'var(--red)' : 'var(--dim)', fontWeight: r.debit_amount > 0 ? 600 : 400 }}>
                    {r.debit_amount > 0 ? `-${fmtRp(r.debit_amount)}` : '—'}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 11 }}>
                    {r.running_balance !== null ? fmtRp(r.running_balance) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
  const [business, setBusiness]   = useState('');       // '' = all
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);

  // account_no → business_name mapping
  const acctMap: Record<string, string> = {};
  bankAccounts.forEach(a => { acctMap[a.account_no] = a.business_name; });
  const businesses = [...new Set(bankAccounts.map(a => a.business_name))].sort();

  // Fetch bank accounts (for mapping)
  useEffect(() => {
    fetch('/api/bank-accounts').then(r => r.json()).then(d => {
      setBankAccounts(d.accounts || []);
    }).catch(() => {});
  }, []);

  const fetchData = useCallback(async (p?: string, biz?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '0' });
      if (p) params.set('period', p);
      const activeBiz = biz !== undefined ? biz : business;
      if (activeBiz) params.set('business', activeBiz);
      const res = await fetch(`/api/bank-cashflow?${params}`);
      const d   = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d);
      if (!p && d.currentPeriod) setPeriod(d.currentPeriod);
    } catch (e: any) {
      setError(e.message || 'Gagal memuat data');
    }
    setLoading(false);
  }, [business]);

  useEffect(() => { fetchData(); }, []);

  function changeBusiness(biz: string) {
    setBusiness(biz);
    fetchData(period || undefined, biz);
  }

  async function handleDelete(bank: string, periodLabel: string, accountNo?: string) {
    const biz = accountNo ? acctMap[accountNo] : '';
    const label = [biz, bank, accountNo && accountNo !== 'UNKNOWN' ? accountNo : '', periodLabel].filter(Boolean).join(' · ');
    if (!confirm(`Hapus data ${label}?`)) return;
    let url = `/api/bank-cashflow?bank=${bank}&period=${encodeURIComponent(periodLabel)}`;
    if (accountNo) url += `&account=${encodeURIComponent(accountNo)}`;
    await fetch(url, { method: 'DELETE' });
    fetchData(period || undefined);
  }

  const sessions: Session[] = data?.sessions || [];
  const dailyData: DailyRow[] = data?.dailyData || [];
  const periods: string[] = data?.periods || [];

  // Combined totals
  const combined = sessions.reduce((acc, s) => ({
    credit:  acc.credit  + (s.total_credit    || 0),
    debit:   acc.debit   + (s.total_debit     || 0),
    opening: acc.opening + (s.opening_balance || 0),
    closing: acc.closing + (s.closing_balance || 0),
  }), { credit: 0, debit: 0, opening: 0, closing: 0 });

  // Group sessions by business
  const sessionsByBiz: Record<string, Session[]> = {};
  for (const s of sessions) {
    const biz = acctMap[s.account_no] || 'Lainnya';
    if (!sessionsByBiz[biz]) sessionsByBiz[biz] = [];
    sessionsByBiz[biz].push(s);
  }
  const bizGroups = Object.keys(sessionsByBiz).sort();

  const pillBtn = (label: string, active: boolean, onClick: () => void, color?: string) => (
    <button
      onClick={onClick}
      style={{
        padding: '5px 14px', borderRadius: 999, border: active ? 'none' : '1px solid var(--border)',
        fontSize: 12, cursor: 'pointer', fontWeight: active ? 700 : 500, transition: 'all 0.15s',
        background: active ? (color || 'var(--accent)') : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
      }}
    >{label}</button>
  );

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

      {/* ── Business Filter ── */}
      {businesses.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--dim)', marginRight: 4, fontWeight: 600 }}>Bisnis:</span>
          {pillBtn('Semua', !business, () => changeBusiness(''))}
          {businesses.map(b => pillBtn(b, business === b, () => changeBusiness(b), BIZ_COLORS[b]))}
        </div>
      )}

      {/* ── Upload Panel ── */}
      {uploadOpen && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Upload Mutasi Rekening</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14 }}>
            Format bank terdeteksi otomatis. Rekening akan dipetakan ke bisnis berdasarkan Financial Settings.
          </div>
          <UploadZone onUploaded={() => { fetchData(period || undefined); }} />
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
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Belum Ada Data{business ? ` untuk ${business}` : ''}</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16 }}>
            Upload file CSV mutasi rekening dari BCA, BRI, atau Mandiri untuk memulai.
          </div>
          <button
            onClick={() => setUploadOpen(true)}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
          >↑ Upload Sekarang</button>
        </div>
      )}

      {/* ── Dashboard Content ── */}
      {!loading && sessions.length > 0 && (
        <>
          {/* Combined summary */}
          <div style={{ background: 'var(--card)', border: '2px solid var(--accent)', borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Saldo Awal</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{fmtRp(combined.opening)}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(combined.opening)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Saldo Akhir</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{fmtRp(combined.closing)}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(combined.closing)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Cash Masuk</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--green)' }}>+{fmtRp(combined.credit)}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(combined.credit)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Cash Keluar</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--red)' }}>-{fmtRp(combined.debit)}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(combined.debit)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Net Cash Flow</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: combined.credit - combined.debit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {combined.credit - combined.debit >= 0 ? '+' : ''}{fmtRp(combined.credit - combined.debit)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{fmtFull(Math.abs(combined.credit - combined.debit))}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Periode</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{period || '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>
                  {sessions.length} rekening{business ? ` · ${business}` : ''}
                </div>
              </div>
            </div>
          </div>

          {/* Per-business compact tables */}
          {bizGroups.map(biz => (
            <BizTable
              key={biz}
              sessions={sessionsByBiz[biz]}
              bizName={biz}
              onDelete={(s) => handleDelete(s.bank, s.period_label, s.account_no)}
            />
          ))}

          {/* Daily chart */}
          {dailyData.length > 0 && <DailyChart data={dailyData} />}

          {/* Transaction table */}
          <TransactionTable periodLabel={period} business={business} acctMap={acctMap} />
        </>
      )}
    </div>
  );
}
