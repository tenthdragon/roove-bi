'use client';
import { useEffect, useState } from 'react';
import { getAdvertiserBrandAssignments, saveAdvertiserBrandAssignments } from '@/lib/advertiser-brand-actions';

export default function AdvertiserBrandAssignments({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getAdvertiserBrandAssignments>> | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true; setData(null); setMessage('');
    void getAdvertiserBrandAssignments(userId).then(result => {
      if (alive && result.workspaceId === workspaceId) { setData(result); setSelected(result.brandIds); }
    }).catch(e => { if (alive) setMessage(e instanceof Error ? e.message : 'Gagal memuat alokasi.'); });
    return () => { alive = false; };
  }, [userId, workspaceId]);
  async function save() {
    setBusy(true); setMessage('');
    try { await saveAdvertiserBrandAssignments(userId, selected, workspaceId); setMessage('Alokasi brand tersimpan.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Gagal menyimpan alokasi.'); }
    finally { setBusy(false); }
  }
  return <fieldset disabled={busy} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
    <legend style={{ fontWeight: 600 }}>Brand yang dapat diakses</legend>
    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px' }}>Pilih satu atau lebih brand. Tanpa pilihan, advertiser tidak dapat melihat data Meta Ads.</p>
    {!data && !message && <span>Memuat brand…</span>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>{data?.brands.map(brand => <label key={brand.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" checked={selected.includes(brand.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, brand.id] : ids.filter(id => id !== brand.id))} />{brand.name}
    </label>)}</div>
    {data && <button type="button" onClick={() => void save()} disabled={busy} style={{ marginTop: 12, padding: '6px 12px' }}>{busy ? 'Menyimpan…' : 'Simpan alokasi brand'}</button>}
    {message && <p role="status" style={{ fontSize: 12, marginBottom: 0 }}>{message}</p>}
  </fieldset>;
}
