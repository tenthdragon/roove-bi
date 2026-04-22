// @ts-nocheck
'use client';

import MarketplaceMappingManager from '@/components/MarketplaceMappingManager';

export default function MarketplaceMappingPage() {
  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketplace Mapping</h2>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 18, maxWidth: 920 }}>
        Halaman ini menyimpan rule deterministik untuk mengubah identifier marketplace menjadi alokasi store Scalev yang tepat, sekaligus optional decode ke bundle, variant, atau product di business yang sudah terkunci oleh source account.
      </div>
      <MarketplaceMappingManager />
    </div>
  );
}
