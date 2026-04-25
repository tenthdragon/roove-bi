// @ts-nocheck
'use client';

import { useMemo, useState } from 'react';

import MarketplaceIntakeManager from '@/components/MarketplaceIntakeManager';
import MarketplaceWebhookQuarantinePanel from '@/components/MarketplaceWebhookQuarantinePanel';

const subMenuStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '9px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
};

export default function MarketplaceIntakePage() {
  const [subMenu, setSubMenu] = useState('workspace');

  const subMenuMeta = useMemo(() => ({
    workspace: {
      title: 'Workspace Intake',
      helper: 'Upload, preview, staging warehouse, lalu promote / push sesuai batch.',
    },
    quarantine: {
      title: 'Webhook Quarantine',
      helper: 'Inbox webhook marketplace yang ditahan agar tidak mengoverride source of truth dari Marketplace Intake.',
    },
  }), []);

  const activeMeta = subMenuMeta[subMenu] || subMenuMeta.workspace;

  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketplace Intake</h2>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 18, maxWidth: 920 }}>
        Tahap pertama untuk jalur baru marketplace. Pilih source yang sesuai, upload file marketplace, lalu app akan match exact SKU Excel ke bundle <strong>custom_id</strong> di business yang tepat dan menaruh hasilnya ke <strong>workspace warehouse</strong>.
        Data baru dianggap valid downstream setelah warehouse memberi <strong>shipment date</strong>.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button
          onClick={() => setSubMenu('workspace')}
          style={{
            ...subMenuStyle,
            background: subMenu === 'workspace' ? '#2563eb' : 'var(--bg)',
            color: subMenu === 'workspace' ? '#fff' : 'var(--text-secondary)',
            borderColor: subMenu === 'workspace' ? '#2563eb' : 'var(--border)',
          }}
        >
          Workspace Intake
        </button>
        <button
          onClick={() => setSubMenu('quarantine')}
          style={{
            ...subMenuStyle,
            background: subMenu === 'quarantine' ? 'rgba(245,158,11,0.14)' : 'var(--bg)',
            color: subMenu === 'quarantine' ? '#fcd34d' : 'var(--text-secondary)',
            borderColor: subMenu === 'quarantine' ? 'rgba(245,158,11,0.28)' : 'var(--border)',
          }}
        >
          Webhook Quarantine
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 18, maxWidth: 980, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>{activeMeta.title}</strong>
        {' — '}
        {activeMeta.helper}
      </div>

      {subMenu === 'workspace' ? (
        <MarketplaceIntakeManager />
      ) : (
        <MarketplaceWebhookQuarantinePanel />
      )}
    </div>
  );
}
