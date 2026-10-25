// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import { getPresetRanges } from '@/lib/utils';
import { metaReportPresets } from '@/lib/meta-report-status';
import { getTodayWIB } from '@/lib/sync-schedule';

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  earliest?: string;
  latest?: string;
  completedDaysOnly?: boolean;
}

export default function DateRangePicker({ from, to, onChange, earliest, latest, completedDaysOnly = false }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const presets = completedDaysOnly ? metaReportPresets(getTodayWIB()) : getPresetRanges();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectRange = (nextFrom: string, nextTo: string) => {
    onChange(nextFrom, nextTo);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const displayText = () => {
    if (from === to) {
      return new Date(from + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const f = new Date(from + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    const t = new Date(to + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${f} — ${t}`;
  };

  return (
    <div ref={ref} className="date-range-picker" style={{ position: 'relative' }}>
      <button className="date-range-trigger" ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls="date-range-popover" onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'var(--card)',
        color: 'var(--text)', fontSize: 13, fontWeight: 500,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {displayText()}
      </button>

      {open && (
        <div id="date-range-popover" role="dialog" aria-label="Pilih rentang tanggal" style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 50,
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 16, minWidth: 280, boxShadow: 'var(--shadow)',
        }} className="date-range-popover fade-in">
          {/* Presets */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Quick Select
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {presets.map(p => (
                <button type="button" key={p.label} onClick={() => selectRange(p.from, p.to)}
                  style={{
                    padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
                    background: from === p.from && to === p.to ? 'var(--accent-solid)' : 'transparent',
                    color: from === p.from && to === p.to ? '#fff' : 'var(--text-secondary)',
                    fontSize: 12, cursor: 'pointer', fontWeight: 500,
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Custom Range
            </div>
            <div className="date-range-inputs" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" aria-label="Tanggal mulai" value={from}
                min={earliest} max={latest}
                onChange={e => onChange(e.target.value, to)}
                style={{
                  flex: 1, padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  color: 'var(--text)', fontSize: 12,
                }} />
              <span style={{ color: 'var(--dim)', fontSize: 12 }}>→</span>
              <input type="date" aria-label="Tanggal akhir" value={to}
                min={earliest} max={latest}
                onChange={e => onChange(from, e.target.value)}
                style={{
                  flex: 1, padding: '6px 8px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  color: 'var(--text)', fontSize: 12,
                }} />
            </div>
          </div>

          {/* All time */}
          {earliest && latest && !completedDaysOnly && (
            <button type="button" onClick={() => selectRange(earliest, latest)}
              style={{
                marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--dim)', fontSize: 12, cursor: 'pointer', fontWeight: 500,
              }}>
              Semua Data ({earliest} → {latest})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
