// @ts-nocheck
'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchAllBrands, addBrand, toggleBrand, deleteBrandPermanently } from '@/lib/brand-actions';

export default function BrandManager() {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newSheet, setNewSheet] = useState('');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // brand id being confirmed
  const [deleteTyped, setDeleteTyped] = useState('');

  const C = { card: '#111a2e', bdr: '#1a2744', dim: '#64748b', txt: '#e2e8f0', bg: '#0b1121' };

  const loadBrands = useCallback(async () => {
    try {
      const data = await fetchAllBrands();
      setBrands(data);
    } catch (err) {
      console.error('Failed to load brands:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBrands(); }, [loadBrands]);

  const handleAdd = async () => {
    if (!newName.trim()) { setMsg({ type: 'error', text: 'Nama brand wajib diisi' }); return; }
    const sheetName = newSheet.trim() || newName.trim();
    setAdding(true);
    setMsg(null);
    try {
      const result = await addBrand(newName.trim(), sheetName);
      if (result.success) {
        setMsg({ type: 'success', text: `Brand "${newName.trim()}" berhasil ditambahkan` });
        setNewName('');
        setNewSheet('');
        await loadBrands();
      } else {
        setMsg({ type: 'error', text: result.error });
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (brand) => {
    try {
      await toggleBrand(brand.id, !brand.is_active);
      await loadBrands();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleDeletePermanent = async (brand) => {
    try {
      const result = await deleteBrandPermanently(brand.id);
      setConfirmDelete(null);
      setDeleteTyped('');
      const totalDeleted = Object.values(result.deleted).reduce((a, b) => a + b, 0);
      setMsg({ type: 'success', text: `Brand "${brand.name}" dihapus permanen. ${totalDeleted} rows data terhapus.` });
      await loadBrands();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const activeBrands = brands.filter(b => b.is_active);
  const inactiveBrands = brands.filter(b => !b.is_active);

  if (loading) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ color: C.dim, fontSize: 13 }}>Memuat daftar brand...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Add Brand Form ── */}
      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Tambah Brand Baru</div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
          Nama brand akan digunakan di seluruh dashboard. Sheet name = nama tab di spreadsheet.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ fontSize: 11, color: C.dim, display: 'block', marginBottom: 4 }}>Nama Brand *</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Contoh: NovaSkin"
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.bg, color: C.txt, fontSize: 13, outline: 'none' }}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ fontSize: 11, color: C.dim, display: 'block', marginBottom: 4 }}>Sheet Name <span style={{ color: `${C.dim}88` }}>(opsional, default = nama brand)</span></label>
            <input
              value={newSheet}
              onChange={e => setNewSheet(e.target.value)}
              placeholder={newName || 'Sama dengan nama brand'}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.bdr}`, background: C.bg, color: C.txt, fontSize: 13, outline: 'none' }}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding}
            style={{ padding: '8px 20px', borderRadius: 6, border: 'none', cursor: adding ? 'not-allowed' : 'pointer', background: adding ? '#1a2744' : '#3b82f6', color: '#fff', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', opacity: adding ? 0.6 : 1 }}
          >
            {adding ? 'Menambahkan...' : '+ Tambah'}
          </button>
        </div>
        {msg && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 6, fontSize: 12, background: msg.type === 'success' ? '#064e3b' : '#7f1d1d', color: msg.type === 'success' ? '#10b981' : '#ef4444' }}>
            {msg.type === 'success' ? '✅' : '❌'} {msg.text}
          </div>
        )}
      </div>

      {/* ── Active Brands ── */}
      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Brand Aktif</div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
          {activeBrands.length} brand aktif — muncul di semua halaman dashboard
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {activeBrands.map(b => (
            <div key={b.id} style={{ padding: '10px 14px', background: C.bg, borderRadius: 8, border: `1px solid ${C.bdr}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</span>
                {b.sheet_name !== b.name && (
                  <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>sheet: {b.sheet_name}</span>
                )}
              </div>
              <button
                onClick={() => handleToggle(b)}
                style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${C.bdr}`, cursor: 'pointer', background: 'none', color: '#f59e0b', fontSize: 11, fontWeight: 600 }}
              >
                Nonaktifkan
              </button>
            </div>
          ))}
          {activeBrands.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20, color: C.dim, fontSize: 13 }}>Tidak ada brand aktif</div>
          )}
        </div>
      </div>

      {/* ── Inactive Brands ── */}
      {inactiveBrands.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: C.dim }}>Brand Nonaktif</div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 14 }}>
            Tidak muncul di dashboard. Data tetap tersimpan di database.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {inactiveBrands.map(b => (
              <div key={b.id} style={{ padding: '10px 14px', background: C.bg, borderRadius: 8, border: '1px solid #7f1d1d33', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, opacity: 0.7 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: C.dim }}>{b.name}</span>
                  {b.sheet_name !== b.name && (
                    <span style={{ fontSize: 11, color: `${C.dim}88`, marginLeft: 8 }}>sheet: {b.sheet_name}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => handleToggle(b)}
                    style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#064e3b', color: '#10b981', fontSize: 11, fontWeight: 600 }}
                  >
                    Aktifkan
                  </button>
                  {confirmDelete === b.id ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        value={deleteTyped}
                        onChange={e => setDeleteTyped(e.target.value)}
                        placeholder={`Ketik "${b.name}"`}
                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #7f1d1d', background: '#0b1121', color: '#ef4444', fontSize: 11, width: 120 }}
                      />
                      <button
                        onClick={() => handleDeletePermanent(b)}
                        disabled={deleteTyped !== b.name}
                        style={{ padding: '4px 10px', borderRadius: 4, border: 'none', cursor: deleteTyped === b.name ? 'pointer' : 'not-allowed', background: deleteTyped === b.name ? '#7f1d1d' : '#1a2744', color: deleteTyped === b.name ? '#ef4444' : '#64748b', fontSize: 11, fontWeight: 700 }}
                      >
                        Hapus
                      </button>
                      <button
                        onClick={() => { setConfirmDelete(null); setDeleteTyped(''); }}
                        style={{ padding: '4px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'none', color: C.dim, fontSize: 11 }}
                      >
                        Batal
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(b.id)}
                      style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #7f1d1d', cursor: 'pointer', background: 'none', color: '#ef4444', fontSize: 11, fontWeight: 600 }}
                    >
                      Hapus Permanen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
