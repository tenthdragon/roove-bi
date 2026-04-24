'use client';

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import {
  deleteWarehouseBusinessDirectoryEntry,
  getWarehouseBusinessDirectoryEntries,
  saveWarehouseBusinessDirectoryEntry,
} from '@/lib/warehouse-domain-actions';

const inputStyle: CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
};

export default function WarehouseBusinessDirectoryTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [draft, setDraft] = useState({
    external_name: '',
    business_id: '',
    business_code: '',
    notes: '',
    is_active: true,
  });

  async function loadData() {
    setLoading(true);
    try {
      const payload = await getWarehouseBusinessDirectoryEntries();
      setEntries(payload.entries || []);
      setBusinesses(payload.businesses || []);
      if (payload.schema_ready === false) {
        setMessage({ type: 'error', text: payload.schema_message || 'Schema Business Directory belum siap.' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat Business Directory.' });
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveWarehouseBusinessDirectoryEntry({
        external_name: draft.external_name,
        business_id: draft.business_id ? Number(draft.business_id) : null,
        business_code: draft.business_code,
        notes: draft.notes,
        is_active: draft.is_active,
      });
      setDraft({ external_name: '', business_id: '', business_code: '', notes: '', is_active: true });
      setMessage({ type: 'success', text: 'Alias business disimpan.' });
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan alias business.' });
    }
    setSaving(false);
  }

  async function handleToggle(entry: any) {
    setSaving(true);
    try {
      await saveWarehouseBusinessDirectoryEntry({
        id: entry.id,
        external_name: entry.external_name,
        business_id: entry.business_id,
        business_code: entry.business_code,
        notes: entry.notes,
        is_active: !entry.is_active,
      });
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal mengubah status alias.' });
    }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm('Hapus alias business ini?')) return;
    setSaving(true);
    try {
      await deleteWarehouseBusinessDirectoryEntry(id);
      setMessage({ type: 'success', text: 'Alias business dihapus.' });
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menghapus alias business.' });
    }
    setSaving(false);
  }

  return (
    <>
      {message ? (
        <div style={{
          padding: '8px 12px',
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 12,
          background: message.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          color: message.type === 'success' ? '#6ee7b7' : '#fca5a5',
        }}>
          {message.text}
        </div>
      ) : null}

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Business Directory</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
          Alias ini menjadi kamus normalisasi untuk `business_name`, `origin_business_name`, dan `item_owner`.
          Source of truth deduction owner-aware akan membaca label external lewat tabel ini sebelum memutuskan seller, operator, dan owner stok.
        </div>
      </div>

      <form onSubmit={handleSave} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Tambah Alias</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Nama External</label>
            <input value={draft.external_name} onChange={(e) => setDraft((current) => ({ ...current, external_name: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Business</label>
            <select
              value={draft.business_id}
              onChange={(e) => {
                const business = businesses.find((row) => String(row.id) === e.target.value) || null;
                setDraft((current) => ({
                  ...current,
                  business_id: e.target.value,
                  business_code: business?.business_code || current.business_code,
                }));
              }}
              style={inputStyle}
            >
              <option value="">Pilih</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>{business.business_code}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Business Code</label>
            <input value={draft.business_code} onChange={(e) => setDraft((current) => ({ ...current, business_code: e.target.value.toUpperCase() }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Catatan</label>
            <input value={draft.notes} onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))} style={inputStyle} />
          </div>
          <button
            type="submit"
            disabled={saving}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            Simpan
          </button>
        </div>
      </form>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--dim)' }}>Memuat...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nama External', 'Business Code', 'Catatan', 'Status', 'Aksi'].map((label) => (
                  <th key={label} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontWeight: 700 }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{entry.external_name}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{entry.business_code}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--dim)' }}>{entry.notes || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      onClick={() => handleToggle(entry)}
                      disabled={saving}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: '1px solid var(--border)',
                        background: entry.is_active ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                        color: entry.is_active ? '#6ee7b7' : '#fca5a5',
                        cursor: 'pointer',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {entry.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      disabled={saving}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: '#fca5a5', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--dim)' }}>
                    Belum ada alias business.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
