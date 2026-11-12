'use client';

// Shared pieces of the Bukti Potong page: status labels, formatters, button and
// table styles, and the small presentational components every section uses.

import React, { useEffect, useId, useRef, type ReactNode } from 'react';
import type { SlipStatus } from '@/lib/tax-withholding-domain';

export type PageMessage = { type: 'success' | 'error'; text: string };
export type Notify = (message: PageMessage) => void;

export const STATUS_LABELS: Record<SlipStatus, string> = {
  draft: 'Draft', ready: 'Siap', exported: 'Di-export', reported: 'Dilaporkan', paid: 'Dibayar',
};
export const STATUS_TONE: Record<SlipStatus, 'muted' | 'accent' | 'yellow' | 'green' | 'green'> = {
  draft: 'muted', ready: 'accent', exported: 'yellow', reported: 'green', paid: 'green',
};
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
export const formatMoney = (value: string | number | null | undefined, decimals = 0) => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return decimals > 0
    ? new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(number)
    : rupiah.format(number);
};
export const formatDate = (date: string | null) => {
  if (!date) return '—';
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Terjadi kesalahan.');
export const formatDateTime = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
export function downloadTextFile(fileName: string, content: string, mime = 'application/xml;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const inputStyle = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 8,
  background: 'var(--input-bg)', color: 'var(--text)', padding: '10px 12px', fontSize: 13, boxSizing: 'border-box',
} as const;
export const labelStyle = { display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 } as const;
export const secondaryButtonStyle = {
  border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px',
  color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer', fontWeight: 650,
} as const;
export const primaryButtonStyle = {
  border: 0, borderRadius: 8, padding: '10px 16px', background: 'var(--accent-solid)', color: '#fff', fontWeight: 700, cursor: 'pointer',
} as const;
export const cellStyle = { padding: '11px 12px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' } as const;
export const headCellStyle = { ...cellStyle, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--dim)', textAlign: 'left' } as const;
export const numberCellStyle = { ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const;

export function StatusPill({ tone, children }: { tone: 'green' | 'yellow' | 'red' | 'muted' | 'accent'; children: ReactNode }) {
  const palette = {
    green: { background: 'var(--green-subtle)', color: 'var(--green)' },
    yellow: { background: 'color-mix(in srgb, var(--yellow) 14%, transparent)', color: 'var(--yellow)' },
    red: { background: 'color-mix(in srgb, var(--red) 14%, transparent)', color: 'var(--red)' },
    muted: { background: 'var(--input-bg)', color: 'var(--dim)' },
    accent: { background: 'var(--accent-subtle)', color: 'var(--accent)' },
  }[tone];
  return <span className="tw-pill" style={palette}>{children}</span>;
}

export function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="tw-summary-card">
      <div style={{ color: 'var(--dim)', fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 750, marginTop: 6, overflowWrap: 'anywhere' }}>{value}</div>
      {hint ? <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export function ModalShell({ title, subtitle, onClose, maxWidth = 760, children }: {
  title: string; subtitle?: string; onClose: () => void; maxWidth?: number; children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', handleKeyDown);
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled])')?.focus();
    }, 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <div className="tw-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="tw-modal-panel" style={{ maxWidth }}>
        <div className="tw-modal-header">
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 17 }}>{title}</h2>
            {subtitle ? <div style={{ color: 'var(--dim)', fontSize: 12, marginTop: 4 }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} className="tw-close-button" aria-label="Tutup dialog">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
