// @ts-nocheck
'use client';

import MarketplaceIntakeManager from '@/components/MarketplaceIntakeManager';

export default function MarketplaceIntakePage() {
  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketplace Intake</h2>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 18, maxWidth: 920 }}>
        Tahap pertama untuk jalur baru marketplace. Upload file <strong>Shopee RLT</strong>, lihat dulu hasil identifikasi exact <strong>custom_id</strong>,
        store final, dan order yang masih perlu dibenahi sebelum data disimpan sebagai snapshot intake.
      </div>
      <MarketplaceIntakeManager />
    </div>
  );
}
