// @ts-nocheck
'use client';

import { useState, useRef, useEffect } from 'react';
import { getPresetRanges } from '@/lib/utils';

interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  earliest?: string;
  latest?: string;
}

export default function DateRangePicker({ from, to, onChange, earliest, latest }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const presets = getPresetRanges();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const displayText = () => {
    if (from === to) {
      return new Date(from + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const f = new Date(from + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    const t = new Date(to + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${f} — ${t}`;
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px', borderRadius: 8,
        border: '1px solid #1a2744', background: '#111a2e',
        color: '#e2e8f0', fontSize: 13, fontWeight: 500,
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
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 50,
          background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12,
          padding: 16, minWidth: 280, boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        }} className="fade-in">
          {/* Presets */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Quick Select
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {presets.map(p => (
                <button key={p.label} onClick={() => { onChange(p.from, p.to); setOpen(false); }}
                  style={{
                    padding: '5px 10px', borderRadius: 6, border: '1px solid #1a2744',
                    background: from === p.from && to === p.to ? '#3b82f6' : 'transparent',
                    color: from === p.from && to === p.to ? '#fff' : '#94a3b8',
                    fontSize: 12, cursor: 'pointer', fontWeight: 500,
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #1a2744', paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Custom Range
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={from}
                min={earliest} max={latest}
                onChange={e => onChange(e.target.value, to)}
                style={{
                  flex: 1, padding: '6px 8px', borderRadius: 6,
                  border: '1px solid #1a2744', background: '#0b1121',
                  color: '#e2e8f0', fontSize: 12,
                }} />
              <span style={{ color: '#64748b', fontSize: 12 }}>→</span>
              <input type="date" value={to}
                min={earliest} max={latest}
                onChange={e => onChange(from, e.target.value)}
                style={{
                  flex: 1, padding: '6px 8px', borderRadius: 6,
                  border: '1px solid #1a2744', background: '#0b1121',
                  color: '#e2e8f0', fontSize: 12,
                }} />
            </div>
          </div>

          {/* All time */}
          {earliest && latest && (
            <button onClick={() => { onChange(earliest, latest); setOpen(false); }}
              style={{
                marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 6,
                border: '1px solid #1a2744', background: 'transparent',
                color: '#64748b', fontSize: 12, cursor: 'pointer', fontWeight: 500,
              }}>
              Semua Data ({earliest} → {latest})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
