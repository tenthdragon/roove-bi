'use client';

import React from 'react';
import { META_TEMPLATE_SCHEMA_MESSAGE } from '@/lib/meta-template-settings';

export default function MetaTemplateSuggestionButton({ rulesReady, busy, onApply, className, children = 'Terapkan saran' }: {
  rulesReady: boolean; busy: boolean; onApply: () => void; className?: string; children?: React.ReactNode;
}) {
  return <button type="button" className={className} disabled={busy || !rulesReady}
    title={!rulesReady ? META_TEMPLATE_SCHEMA_MESSAGE : undefined}
    onClick={() => { if (rulesReady && !busy) onApply(); }}>{children}</button>;
}
