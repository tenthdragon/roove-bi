// @ts-nocheck
'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchAllBrands, addBrand, toggleBrand, deleteBrandPermanently, updateBrandKeywords } from '@/lib/brand-actions';

export default function BrandManager() {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newSheet, setNewSheet] = useState('');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // brand id being confirmed
  const [deleteTyped, setDeleteTyped] = useState('');
  const [editingKeywords, setEditingKeywords] = useState(null); // { id, keywords }
  const [savingKeywords, setSavingKeywords] = useState(false);

  const C = { card: 'var(--card)', bdr: 'var(--border)', dim: 'var(--dim)', txt: 'var(--text)', bg: 'var(--bg)' };

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

  const handleSaveKeywords = async () => {
    if (!editingKeywords) return;
    setSavingKeywords(true);
    try {
      await updateBrandKeywords(editingKeywords.id, editingKeywords.keywords);
      setMsg({ type: 'success', text: 'Keywords berhasil disimpan' });
      setEditingKeywords(null);
      await loadBrands();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSavingKeywords(false);
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
            style={{ padding: '8px 20px', borderRadius: 6, border: 'none', cursor: adding ? 'not-allowed' : 'pointer', background: adding ? 'var(--border)' : 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', opacity: adding ? 0.6 : 1 }}
          >
            {adding ? 'Menambahkan...' : '+ Tambah'}
          </button>
        </div>
        {msg && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 6, fontSize: 12, background: msg.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: msg.type === 'success' ? 'var(--green)' : 'var(--red)' }}>
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
            <div key={b.id} style={{ padding: '10px 14px', background: C.bg, borderRadius: 8, border: `1px solid ${C.bdr}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</span>
                  {b.sheet_name !== b.name && (
                    <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>sheet: {b.sheet_name}</span>
                  )}
                </div>
                <button
                  onClick={() => handleToggle(b)}
                  style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${C.bdr}`, cursor: 'pointer', background: 'none', color: 'var(--yellow)', fontSize: 11, fontWeight: 600 }}
                >
                  Nonaktifkan
                </button>
              </div>
              {/* Keywords row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: C.dim, minWidth: 60 }}>Keywords:</span>
                {editingKeywords?.id === b.id ? (
                  <>
                    <input
                      value={editingKeywords.keywords}
                      onChange={e => setEditingKeywords({ ...editingKeywords, keywords: e.target.value })}
                      placeholder={b.name.toLowerCase()}
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.bdr}`, background: C.card, color: C.txt, fontSize: 11, outline: 'none', minWidth: 150 }}
                    />
                    <button onClick={handleSaveKeywords} disabled={savingKeywords} style={{ padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'var(--green)', color: '#fff', fontSize: 10, fontWeight: 600 }}>
                      {savingKeywords ? '...' : 'Simpan'}
                    </button>
                    <button onClick={() => setEditingKeywords(null)} style={{ padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'none', color: C.dim, fontSize: 10 }}>Batal</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                      {b.keywords || b.name.toLowerCase()}
                    </span>
                    <button
                      onClick={() => setEditingKeywords({ id: b.id, keywords: b.keywords || '' })}
                      style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.bdr}`, cursor: 'pointer', background: 'none', color: '#60a5fa', fontSize: 10, fontWeight: 500 }}
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
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
              <div key={b.id} style={{ padding: '10px 14px', background: C.bg, borderRadius: 8, border: '1px solid var(--badge-red-bg)33', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, opacity: 0.7 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: C.dim }}>{b.name}</span>
                  {b.sheet_name !== b.name && (
                    <span style={{ fontSize: 11, color: `${C.dim}88`, marginLeft: 8 }}>sheet: {b.sheet_name}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => handleToggle(b)}
                    style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--badge-green-bg)', color: 'var(--green)', fontSize: 11, fontWeight: 600 }}
                  >
                    Aktifkan
                  </button>
                  {confirmDelete === b.id ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        value={deleteTyped}
                        onChange={e => setDeleteTyped(e.target.value)}
                        placeholder={`Ketik "${b.name}"`}
                        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--badge-red-bg)', background: 'var(--bg)', color: 'var(--red)', fontSize: 11, width: 120 }}
                      />
                      <button
                        onClick={() => handleDeletePermanent(b)}
                        disabled={deleteTyped !== b.name}
                        style={{ padding: '4px 10px', borderRadius: 4, border: 'none', cursor: deleteTyped === b.name ? 'pointer' : 'not-allowed', background: deleteTyped === b.name ? 'var(--badge-red-bg)' : 'var(--border)', color: deleteTyped === b.name ? 'var(--red)' : 'var(--dim)', fontSize: 11, fontWeight: 700 }}
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
                      style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--badge-red-bg)', cursor: 'pointer', background: 'none', color: 'var(--red)', fontSize: 11, fontWeight: 600 }}
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
