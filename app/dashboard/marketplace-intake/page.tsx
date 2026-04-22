// @ts-nocheck
'use client';

import MarketplaceIntakeManager from '@/components/MarketplaceIntakeManager';

export default function MarketplaceIntakePage() {
  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketplace Intake</h2>
      <div style={{ fontSize: 13, color: 'var(--dim)', marginBottom: 18, maxWidth: 920 }}>
        Tahap pertama untuk jalur baru marketplace. Upload file <strong>Shopee RLT</strong>, lalu app akan match exact SKU Excel ke bundle <strong>custom_id</strong> di business <strong>RLT</strong>,
        mengklasifikasikan store final, dan menampilkan order yang masih perlu dibenahi sebelum data disimpan sebagai snapshot intake.
      </div>
      <MarketplaceIntakeManager />
    </div>
  );
}
