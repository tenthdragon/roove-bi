'use client';

import { useEffect, useState } from 'react';
import { getAdvertiserSpendAccess, saveAdvertiserSpendAccess } from '@/lib/manual-marketplace-ad-spend-actions';
import {
  MANUAL_MARKETPLACE_LABELS,
  MANUAL_MARKETPLACE_PLATFORMS,
  type ManualMarketplacePlatform,
} from '@/lib/manual-marketplace-ad-spend';

export default function AdvertiserSpendAccess({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<ManualMarketplacePlatform[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessage('');
    void getAdvertiserSpendAccess(userId).then((result) => {
      if (!alive || result.workspaceId !== workspaceId) return;
      setEnabled(result.enabled);
      setSelected(result.platforms);
    }).catch((error) => {
      if (alive) setMessage(error instanceof Error ? error.message : 'Gagal memuat akses input iklan.');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId, workspaceId]);

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const result = await saveAdvertiserSpendAccess(userId, selected, workspaceId);
      setSelected(result.platforms);
      setMessage('Akses input biaya iklan tersimpan. Advertiser perlu memuat ulang dashboard untuk melihat menu.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gagal menyimpan akses input iklan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset disabled={busy || loading || !enabled} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <legend style={{ fontWeight: 600 }}>Hak input biaya iklan</legend>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
        Pilih platform yang boleh diisi advertiser ini. Input hanya tersedia untuk brand aktif yang dipilih pada “Brand yang dapat diakses”.
      </p>
      {loading ? <span>Memuat akses…</span> : !enabled ? <span>Input biaya iklan belum aktif untuk workspace ini.</span> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {MANUAL_MARKETPLACE_PLATFORMS.map((platform) => (
            <label key={platform} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={selected.includes(platform)}
                onChange={(event) => setSelected((current) => event.target.checked
                  ? [...current, platform]
                  : current.filter((item) => item !== platform))} />
              {MANUAL_MARKETPLACE_LABELS[platform]}
            </label>
          ))}
        </div>
      )}
      {enabled && <button type="button" onClick={() => void save()} disabled={busy || loading}
        style={{ marginTop: 12, padding: '6px 12px' }}>
        {busy ? 'Menyimpan…' : 'Simpan hak input'}
      </button>}
      {message && <p role="status" style={{ fontSize: 12, marginBottom: 0 }}>{message}</p>}
    </fieldset>
  );
}
