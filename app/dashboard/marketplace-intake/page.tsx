// @ts-nocheck
'use client';

import { useMemo, useState } from 'react';

import MarketplaceIntakeManager from '@/components/MarketplaceIntakeManager';
import MarketplaceStoreScopePanel from '@/components/MarketplaceStoreScopePanel';
import MarketplaceSkuAliasPanel from '@/components/MarketplaceSkuAliasPanel';
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
    store_scope: {
      title: 'Store Scope',
      helper: 'Atur store mana saja di tiap business yang boleh dipakai sebagai destinasi atribusi sales untuk source marketplace tertentu.',
    },
    sku_alias: {
      title: 'Resolver Rules',
      helper: 'Pusatkan semua aturan resolver di sini: SKU normalization, entity binding, dan store override permanen untuk line marketplace.',
    },
  }), []);

  const activeMeta = subMenuMeta[subMenu] || subMenuMeta.workspace;

  return (
    <div className="fade-in">
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
        <button
          onClick={() => setSubMenu('store_scope')}
          style={{
            ...subMenuStyle,
            background: subMenu === 'store_scope' ? 'rgba(14,165,233,0.14)' : 'var(--bg)',
            color: subMenu === 'store_scope' ? '#7dd3fc' : 'var(--text-secondary)',
            borderColor: subMenu === 'store_scope' ? 'rgba(14,165,233,0.28)' : 'var(--border)',
          }}
        >
          Store Scope
        </button>
        <button
          onClick={() => setSubMenu('sku_alias')}
          style={{
            ...subMenuStyle,
            background: subMenu === 'sku_alias' ? 'rgba(34,197,94,0.14)' : 'var(--bg)',
            color: subMenu === 'sku_alias' ? '#86efac' : 'var(--text-secondary)',
            borderColor: subMenu === 'sku_alias' ? 'rgba(34,197,94,0.28)' : 'var(--border)',
          }}
        >
          Resolver Rules
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 18, maxWidth: 980, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>{activeMeta.title}</strong>
        {' — '}
        {activeMeta.helper}
      </div>

      {subMenu === 'workspace' ? (
        <MarketplaceIntakeManager />
      ) : subMenu === 'quarantine' ? (
        <MarketplaceWebhookQuarantinePanel />
      ) : subMenu === 'store_scope' ? (
        <MarketplaceStoreScopePanel />
      ) : (
        <MarketplaceSkuAliasPanel />
      )}
    </div>
  );
}
