'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Highlight } from '@/lib/meta-ad-highlights';
import { highlightSymbol, type HighlightPeriod } from '@/lib/meta-inline-highlights';
import { relativeChange } from '@/lib/meta-funnel-domain';
import { formatChange, formatDate, formatMetric } from '@/lib/meta-format';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

const severityClass = { bad: styles.bad, warn: styles.warn, good: styles.good, info: styles.neutral };

/** Portalled so horizontal table scrolling never clips the explanation. */
export function MetaInsightPopover({ label, trigger, children, className, onActivate, heading = 'Sorotan' }: {
  label: string; trigger: ReactNode; children: ReactNode; className?: string; onActivate?: () => void; heading?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const pinned = useRef(false), suppressFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  function cancelClose() { clearTimeout(timer.current); }
  const close = useCallback((restoreFocus = false) => {
    clearTimeout(timer.current); pinned.current = false; setOpen(false);
    if (restoreFocus) { suppressFocus.current = true; button.current?.focus(); suppressFocus.current = false; }
  }, []);
  function leave() {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!pinned.current && !panel.current?.contains(document.activeElement) && document.activeElement !== button.current) setOpen(false);
    }, 160);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    function place() {
      const anchor = button.current?.getBoundingClientRect(), box = panel.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const left = Math.max(8, Math.min(anchor.left, width - box.width - 8));
      const below = anchor.bottom + 8;
      const top = below + box.height <= height - 8 ? below : Math.max(8, anchor.top - box.height - 8);
      setPosition({ left, top });
    }
    function outside(event: PointerEvent) {
      if (!button.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close(!!panel.current?.contains(document.activeElement)); }
    }
    function anotherOpened(event: Event) {
      if ((event as CustomEvent<string>).detail !== id) close();
    }
    document.dispatchEvent(new CustomEvent('meta-insight-open', { detail: id }));
    document.addEventListener('meta-insight-open', anotherOpened);
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('meta-insight-open', anotherOpened);
      observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keyboard);
    };
  }, [open, id, close]);
  return <>
    <button ref={button} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      className={className || styles.insightTrigger}
      onPointerEnter={e => { if (e.pointerType !== 'touch') { cancelClose(); setOpen(true); } }} onPointerLeave={leave}
      onFocus={() => { if (!suppressFocus.current) { cancelClose(); setOpen(true); } }} onBlur={e => { if (e.relatedTarget && !panel.current?.contains(e.relatedTarget as Node)) close(); else leave(); }}
      onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey && open) { e.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); } }}
      onClick={() => {
        if (onActivate) { close(); onActivate(); return; }
        if (pinned.current) close(); else { pinned.current = true; cancelClose(); setOpen(true); }
      }}>{trigger}</button>
    {open && typeof document !== 'undefined' && createPortal(<div ref={panel} id={id} role="dialog" aria-label={label}
      className={styles.insightPopover} style={position} onClick={e => { if ((e.target as HTMLElement).closest(`.${styles.insightDetail}`)) close(); }} onPointerEnter={cancelClose} onPointerLeave={leave}
      onKeyDown={e => {
        if (e.key !== 'Tab') return;
        const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
        if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); button.current?.focus(); }
        else if (!e.shiftKey && document.activeElement === focusable.at(-1)) {
          const outside = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
            .filter(node => !panel.current?.contains(node) && node.getClientRects().length > 0);
          const next = outside[outside.indexOf(button.current!) + 1];
          if (next) { e.preventDefault(); close(); next.focus(); }
        }
      }} onFocus={cancelClose} onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== button.current) close();
      }}>
      <div className={styles.insightHeading}><b>{heading}</b><button type="button" aria-label="Tutup sorotan" onClick={() => close(true)}>×</button></div>
      {children}
    </div>, document.body)}
  </>;
}

export function MetaHighlightValue({ highlights, children, currency, period, onDetail, label }: {
  highlights: Highlight[]; children?: ReactNode; currency: string; period?: HighlightPeriod;
  onDetail?: (highlight: Highlight) => void; label?: string;
}) {
  if (!highlights.length) return <>{children}</>;
  const first = highlights[0];
  return <MetaInsightPopover key={JSON.stringify([highlights, period])} label={label || `${highlights.length} sorotan: ${highlights.map(h => h.title).join(', ')}`}
    trigger={<><span className={severityClass[first.severity]} aria-hidden="true">{highlightSymbol(first)}</span> {children ?? `${highlights.length} sorotan`}</>}>
    {highlights.map((h, index) => <div key={index} className={styles.insightItem}>
      <strong className={severityClass[h.severity]}>{highlightSymbol(h)} {h.title}</strong>
      {h.metric && h.comparison && <>
        <div className={styles.insightMetric}>{h.metric.label}{h.comparison.basis === 'period' && <> · {formatChange(relativeChange(h.comparison.current, h.comparison.reference))}</>}</div>
        <div className={styles.insightComparison}>
          <div><span>{h.comparison.basis === 'period' ? period ? `${formatDate(period.prevFrom)} – ${formatDate(period.prevTo)}` : 'Periode sebelumnya'
            : h.comparison.basis === 'template_median' ? 'Median template' : h.comparison.basis === 'cep_median' ? 'Median CEP' : 'Rata-rata brand'}</span>
            <b>{formatMetric(h.comparison.reference, h.metric, currency)}</b></div>
          <span aria-hidden="true">{h.comparison.basis === 'period' ? '→' : 'vs'}</span>
          <div><span>{period ? `${formatDate(period.from)} – ${formatDate(period.to)}` : 'Periode ini'}</span><b>{formatMetric(h.comparison.current, h.metric, currency)}</b></div>
        </div>
      </>}
      <p>{h.text}</p>
      {onDetail && <button type="button" className={styles.insightDetail} onClick={() => onDetail(h)}>Lihat detail →</button>}
    </div>)}
  </MetaInsightPopover>;
}

export function MetaDataNotesTrigger({ notes, onOpen, disabled }: { notes: Highlight[]; onOpen: () => void; disabled?: boolean }) {
  if (disabled || !notes.length) return <button type="button" className={styles.button} onClick={onOpen} disabled={disabled}>Catatan data</button>;
  return <MetaInsightPopover key={JSON.stringify(notes)} label={`Catatan data: ${notes.length} jenis masalah`} heading="Catatan data" className={`${styles.button} ${styles.notesButton}`}
    trigger={<>⚠ Catatan data · {notes.length}</>} onActivate={onOpen}>
    {notes.map((note, index) => <div key={index} className={styles.insightItem}><strong className={styles.warn}>{note.title}</strong><p>{note.text}</p></div>)}
    <button type="button" className={styles.insightDetail} onClick={onOpen}>Buka catatan data →</button>
  </MetaInsightPopover>;
}
