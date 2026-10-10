'use client';

import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { APP_DEFAULT_THEME, resolveTheme, type ThemePreference } from '@/lib/theme-preference';

type SaveState = 'idle' | 'saving' | 'error';

const DEFAULT_LABEL = APP_DEFAULT_THEME === 'dark' ? 'Dark' : 'Light';

const OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: null, label: `Default aplikasi (${DEFAULT_LABEL})`, hint: 'Ikuti tema default untuk semua pengguna' },
  { value: 'light', label: 'Light', hint: 'Selalu terang untuk akun Anda' },
  { value: 'dark', label: 'Dark', hint: 'Selalu gelap untuk akun Anda' },
];

/**
 * Header theme menu. `preference` is the signed-in user's saved choice:
 * null follows the app default, undefined means the account cannot store it
 * yet (database not migrated), in which case the choice stays in this browser.
 */
export default function ThemeToggle({
  preference,
  onPreferenceSaved,
}: {
  preference?: ThemePreference;
  onPreferenceSaved?: (preference: ThemePreference) => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const accountBacked = preference !== undefined;

  useEffect(() => setMounted(true), []);

  // The saved account preference wins over whatever this browser used last.
  useEffect(() => {
    if (accountBacked) setTheme(resolveTheme(preference));
  }, [accountBacked, preference, setTheme]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!mounted) return <div style={{ width: 32, height: 32 }} />;

  const isDark = resolvedTheme === 'dark';
  const selected: ThemePreference = accountBacked ? preference : isDark ? 'dark' : 'light';

  async function choose(next: ThemePreference) {
    setTheme(resolveTheme(next));
    setSaveError('');
    if (!accountBacked) {
      setSaveState('idle');
      return;
    }
    setSaveState('saving');
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_preference: next }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Preferensi tema gagal disimpan.');
      setSaveState('idle');
      onPreferenceSaved?.(payload.theme_preference ?? null);
    } catch (error: any) {
      setSaveState('error');
      setSaveError(error?.message || 'Preferensi tema gagal disimpan.');
    }
  }

  const visibleOptions = accountBacked ? OPTIONS : OPTIONS.filter((option) => option.value !== null);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((value) => !value)}
        title="Pengaturan tema"
        aria-label="Pengaturan tema"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: open ? 'var(--bg-deep)' : 'none',
          border: '1px solid var(--border)',
          borderRadius: 8,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
          padding: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          transition: 'color 0.2s, border-color 0.2s',
        }}
      >
        {isDark ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Tema tampilan"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            width: 248,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 6,
            zIndex: 60,
          }}
        >
          <div style={{ padding: '6px 8px 4px', fontSize: 11, fontWeight: 600, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tema tampilan
          </div>
          {visibleOptions.map((option) => {
            const checked = selected === option.value;
            return (
              <button
                key={option.label}
                role="menuitemradio"
                aria-checked={checked}
                disabled={saveState === 'saving'}
                onClick={() => choose(option.value)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px',
                  borderRadius: 7,
                  border: 'none',
                  background: checked ? 'var(--accent-subtle)' : 'transparent',
                  cursor: saveState === 'saving' ? 'wait' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    marginTop: 2,
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    borderRadius: '50%',
                    border: `2px solid ${checked ? 'var(--accent)' : 'var(--text-muted)'}`,
                    boxShadow: checked ? 'inset 0 0 0 3px var(--card)' : 'none',
                    background: checked ? 'var(--accent)' : 'transparent',
                  }}
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: checked ? 600 : 500, color: 'var(--text)' }}>{option.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>{option.hint}</span>
                </span>
              </button>
            );
          })}
          <div
            role="status"
            style={{
              margin: '4px 8px 4px',
              paddingTop: 6,
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: saveState === 'error' ? 'var(--red)' : 'var(--text-muted)',
            }}
          >
            {saveState === 'saving'
              ? 'Menyimpan…'
              : saveState === 'error'
                ? saveError
                : accountBacked
                  ? 'Tersimpan di akun Anda, berlaku di semua perangkat.'
                  : 'Tersimpan di browser ini saja.'}
          </div>
        </div>
      )}
    </div>
  );
}
