'use client';

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { getProducts } from '@/lib/warehouse-ledger-actions';
import {
  deleteWarehouseOriginRegistryEntry,
  getWarehouseOriginRegistryEntries,
  saveWarehouseOriginRegistryEntry,
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

export default function WarehouseOriginRegistryTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [warehouseCodes, setWarehouseCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [draft, setDraft] = useState({
    external_origin_business_name: '',
    external_origin_name: '',
    operator_business_id: '',
    operator_business_code: '',
    internal_warehouse_code: 'BTN',
    notes: '',
    is_active: true,
  });

  async function loadData() {
    setLoading(true);
    try {
      const [payload, products] = await Promise.all([
        getWarehouseOriginRegistryEntries(),
        getProducts(),
      ]);
      setEntries(payload.entries || []);
      setBusinesses(payload.businesses || []);
      if (payload.schema_ready === false) {
        setMessage({ type: 'error', text: payload.schema_message || 'Schema Warehouse Registry belum siap.' });
      }
      const nextWarehouseCodes = Array.from(new Set((products || []).map((product: any) => String(product.warehouse || '').trim()).filter(Boolean))).sort();
      setWarehouseCodes(nextWarehouseCodes);
      if (nextWarehouseCodes.length > 0 && !nextWarehouseCodes.includes(draft.internal_warehouse_code)) {
        setDraft((current) => ({ ...current, internal_warehouse_code: nextWarehouseCodes[0] }));
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat Warehouse Registry.' });
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const activeCount = useMemo(
    () => entries.filter((entry) => entry.is_active).length,
    [entries],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveWarehouseOriginRegistryEntry({
        external_origin_business_name: draft.external_origin_business_name,
        external_origin_name: draft.external_origin_name,
        operator_business_id: draft.operator_business_id ? Number(draft.operator_business_id) : null,
        operator_business_code: draft.operator_business_code,
        internal_warehouse_code: draft.internal_warehouse_code,
        notes: draft.notes,
        is_active: draft.is_active,
      });
      setDraft({
        external_origin_business_name: '',
        external_origin_name: '',
        operator_business_id: '',
        operator_business_code: '',
        internal_warehouse_code: warehouseCodes[0] || 'BTN',
        notes: '',
        is_active: true,
      });
      setMessage({ type: 'success', text: 'Origin registry disimpan.' });
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan origin registry.' });
    }
    setSaving(false);
  }

  async function handleToggle(entry: any) {
    setSaving(true);
    try {
      await saveWarehouseOriginRegistryEntry({
        id: entry.id,
        external_origin_business_name: entry.external_origin_business_name,
        external_origin_name: entry.external_origin_name,
        operator_business_id: entry.operator_business_id,
        operator_business_code: entry.operator_business_code,
        internal_warehouse_code: entry.internal_warehouse_code,
        notes: entry.notes,
        is_active: !entry.is_active,
      });
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal mengubah status origin registry.' });
    }
    setSaving(false);
  }

  async function handleDelete(id: number) {
    if (!confirm('Hapus origin registry ini?')) return;
    setSaving(true);
    try {
      await deleteWarehouseOriginRegistryEntry(id);
      setMessage({ type: 'success', text: 'Origin registry dihapus.' });
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menghapus origin registry.' });
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Warehouse Registry</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
              Registry ini memetakan pasangan `origin_business_name + origin` dari ScaleV ke warehouse fisik internal.
              Resolver deduction owner-aware akan berhenti di sini sebelum memutuskan produk mana yang benar-benar dikurangi.
            </div>
          </div>
          <div style={{ minWidth: 180, padding: '10px 12px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>Origin aktif</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{activeCount}</div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Tambah Origin</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.6fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Origin Business External</label>
            <input value={draft.external_origin_business_name} onChange={(e) => setDraft((current) => ({ ...current, external_origin_business_name: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Origin External</label>
            <input value={draft.external_origin_name} onChange={(e) => setDraft((current) => ({ ...current, external_origin_name: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Operator Business</label>
            <select
              value={draft.operator_business_id}
              onChange={(e) => {
                const business = businesses.find((row) => String(row.id) === e.target.value) || null;
                setDraft((current) => ({
                  ...current,
                  operator_business_id: e.target.value,
                  operator_business_code: business?.business_code || current.operator_business_code,
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
            <label style={{ fontSize: 10, color: 'var(--dim)' }}>Warehouse Code</label>
            <select value={draft.internal_warehouse_code} onChange={(e) => setDraft((current) => ({ ...current, internal_warehouse_code: e.target.value }))} style={inputStyle}>
              {(warehouseCodes.length > 0 ? warehouseCodes : ['BTN']).map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
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
                {['Origin Business', 'Origin', 'Operator', 'Warehouse', 'Status', 'Aksi'].map((label) => (
                  <th key={label} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontWeight: 700 }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{entry.external_origin_business_name}</td>
                  <td style={{ padding: '10px 12px' }}>{entry.external_origin_name}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{entry.operator_business_code}</td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{entry.internal_warehouse_code}</td>
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
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--dim)' }}>
                    Belum ada origin registry.
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
