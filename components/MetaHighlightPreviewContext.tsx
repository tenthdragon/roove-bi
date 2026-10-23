'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Highlight } from '@/lib/meta-ad-highlights';
import type { MetaLeakSnapshot } from '@/lib/meta-highlight-snapshot';
import MetaHighlightCardPreview from './MetaHighlightCardPreview';

type Preview = { snapshots: MetaLeakSnapshot[]; open: (snapshot: MetaLeakSnapshot) => void };
const Context = createContext<Preview | null>(null);

export function MetaHighlightPreviewProvider({ snapshots, children }: { snapshots: MetaLeakSnapshot[]; children: ReactNode }) {
  const [selected, setSelected] = useState<MetaLeakSnapshot | null>(null);
  // A revision/scope change must never leave a stale or unauthorized modal visible.
  const visible = selected && snapshots.some(s => s.snapshot_id === selected.snapshot_id) ? selected : null;
  useEffect(() => { if (selected && !visible) setSelected(null); }, [selected, visible]);
  return <Context.Provider value={{ snapshots, open: setSelected }}>{children}
    {visible && <MetaHighlightCardPreview snapshot={visible} onClose={() => setSelected(null)} />}
  </Context.Provider>;
}

export function useMetaHighlightPreview() {
  const context = useContext(Context);
  return (highlight: Highlight): (() => void) | undefined => {
    if (!context || highlight.kind !== 'leak') return;
    const snapshot = context.snapshots.find(s => s.scope.template.key === highlight.sectionKey && s.scope.group.key === highlight.groupKey
      && s.finding.metric.numerator === highlight.metric?.numerator && s.finding.metric.denominator === highlight.metric?.denominator
      && s.finding.comparison.current === highlight.comparison?.current && s.finding.comparison.reference === highlight.comparison?.reference);
    return snapshot ? () => context.open(snapshot) : undefined;
  };
}
