// components/WebhookManager.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  getWebhookBusinesses,
  saveWebhookBusiness,
  deleteWebhookBusiness,
  toggleWebhookBusiness,
} from '@/lib/webhook-actions';

type Business = {
  id: number;
  business_code: string;
  business_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_webhook_at: string | null;
  last_sync_type: string | null;
};

type FormData = {
  id?: number;
  business_code: string;
  business_name: string;
  webhook_secret: string;
};

const EMPTY_FORM: FormData = { business_code: '', business_name: '', webhook_secret: '' };

export default function WebhookManager() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const data = await getWebhookBusinesses();
      setBusinesses(data);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  function openAddForm() {
    setForm(EMPTY_FORM);
    setShowForm(true);
    setMessage(null);
  }

  function openEditForm(biz: Business) {
    setForm({
      id: biz.id,
      business_code: biz.business_code,
      business_name: biz.business_name,
      webhook_secret: '',
    });
    setShowForm(true);
    setMessage(null);
  }

  async function handleSave() {
    if (!form.business_code.trim() || !form.business_name.trim()) return;
    if (!form.id && !form.webhook_secret.trim()) return; // new entry requires secret

    setSaving(true);
    setMessage(null);
    try {
      await saveWebhookBusiness({
        id: form.id,
        business_code: form.business_code,
        business_name: form.business_name,
        webhook_secret: form.webhook_secret || 'unchanged',
      });
      setMessage({ type: 'success', text: form.id ? 'Business berhasil diupdate!' : 'Business berhasil ditambahkan!' });
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setMessage(null);
    try {
      await deleteWebhookBusiness(id);
      setMessage({ type: 'success', text: 'Business berhasil dihapus' });
      setConfirmDelete(null);
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function handleToggle(id: number, currentActive: boolean) {
    setMessage(null);
    try {
      await toggleWebhookBusiness(id, !currentActive);
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Baru saja';
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} jam lalu`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay} hari lalu`;
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  if (loading) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ color: '#64748b', fontSize: 13 }}>Memuat data webhook...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Header Card ── */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Scalev Webhook Businesses</div>
          <button
            onClick={openAddForm}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: '#3b82f6', color: '#fff', fontSize: 12, fontWeight: 600,
            }}
          >
            + Tambah Business
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Daftar business Scalev yang mengirim webhook. Setiap business punya secret key sendiri untuk verifikasi HMAC.
        </div>
        <div style={{ fontSize: 11, color: '#475569', padding: '8px 10px', background: '#0c1b3a', borderRadius: 6, marginBottom: 14 }}>
          <strong>Webhook URL:</strong>{' '}
          <span style={{ color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
            https://roove-bi.vercel.app/api/scalev-webhook
          </span>
          <span style={{ color: '#64748b' }}> — gunakan URL ini di semua dashboard Scalev, cukup bedakan secret key-nya.</span>
        </div>

        {/* Messages */}
        {message && (
          <div style={{
            marginBottom: 12, padding: 12, borderRadius: 8, fontSize: 13,
            background: message.type === 'success' ? '#064e3b' : '#7f1d1d',
            color: message.type === 'success' ? '#10b981' : '#ef4444',
          }}>
            {message.text}
          </div>
        )}

        {/* ── Add/Edit Form ── */}
        {showForm && (
          <div style={{
            padding: 14, background: '#0c1b3a', border: '1px solid #1e3a5f',
            borderRadius: 8, marginBottom: 14,
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              {form.id ? 'Edit Business' : 'Tambah Business Baru'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: '0 0 120px' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Kode (unik)</div>
                  <input
                    type="text"
                    value={form.business_code}
                    onChange={(e) => setForm({ ...form, business_code: e.target.value.toUpperCase() })}
                    placeholder="RTI"
                    maxLength={10}
                    disabled={!!form.id}
                    style={{
                      width: '100%', padding: '8px 12px', background: form.id ? '#1a2744' : '#0b1121',
                      border: '1px solid #1a2744', borderRadius: 6, color: '#e2e8f0', fontSize: 13,
                      outline: 'none', opacity: form.id ? 0.6 : 1,
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Nama Business</div>
                  <input
                    type="text"
                    value={form.business_name}
                    onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                    placeholder="Roove Tijara Internasional"
                    style={{
                      width: '100%', padding: '8px 12px', background: '#0b1121',
                      border: '1px solid #1a2744', borderRadius: 6, color: '#e2e8f0', fontSize: 13,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                  Webhook Secret {form.id && <span style={{ color: '#475569' }}>(kosongkan jika tidak ingin mengubah)</span>}
                </div>
                <input
                  type="password"
                  value={form.webhook_secret}
                  onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })}
                  placeholder={form.id ? '••••••••••' : 'Secret dari Scalev dashboard'}
                  style={{
                    width: '100%', padding: '8px 12px', background: '#0b1121',
                    border: '1px solid #1a2744', borderRadius: 6, color: '#e2e8f0', fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.business_code.trim() || !form.business_name.trim() || (!form.id && !form.webhook_secret.trim())}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: '#1e40af', color: '#93c5fd', fontSize: 12, fontWeight: 600,
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                  style={{
                    padding: '8px 16px', borderRadius: 6, border: '1px solid #1a2744', cursor: 'pointer',
                    background: 'transparent', color: '#64748b', fontSize: 12, fontWeight: 600,
                  }}
                >
                  Batal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Business Table ── */}
        {businesses.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: 20 }}>
            Belum ada business terdaftar. Klik &quot;+ Tambah Business&quot; untuk memulai.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2744' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>KODE</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>NAMA BUSINESS</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>STATUS</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>WEBHOOK TERAKHIR</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 11 }}>AKSI</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((biz) => (
                  <tr key={biz.id} style={{ borderBottom: '1px solid #0f1d32' }}>
                    <td style={{ padding: '10px 10px', fontFamily: 'JetBrains Mono, monospace', color: '#e2e8f0', fontWeight: 600 }}>
                      {biz.business_code}
                    </td>
                    <td style={{ padding: '10px 10px', color: '#e2e8f0' }}>
                      {biz.business_name}
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <span
                        onClick={() => handleToggle(biz.id, biz.is_active)}
                        style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          background: biz.is_active ? '#064e3b' : '#78350f',
                          color: biz.is_active ? '#10b981' : '#f59e0b',
                        }}
                      >
                        {biz.is_active ? '● Aktif' : '○ Nonaktif'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 10px', color: '#64748b', fontSize: 12 }}>
                      {formatTime(biz.last_webhook_at)}
                      {biz.last_sync_type && (
                        <span style={{ color: '#475569', marginLeft: 6 }}>
                          ({biz.last_sync_type.replace('webhook_', '')})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => openEditForm(biz)}
                          style={{
                            padding: '4px 10px', borderRadius: 4, border: '1px solid #1a2744',
                            background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                        {confirmDelete === biz.id ? (
                          <>
                            <button
                              onClick={() => handleDelete(biz.id)}
                              style={{
                                padding: '4px 10px', borderRadius: 4, border: 'none',
                                background: '#7f1d1d', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                              }}
                            >
                              Yakin?
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              style={{
                                padding: '4px 10px', borderRadius: 4, border: '1px solid #1a2744',
                                background: 'transparent', color: '#64748b', fontSize: 11, cursor: 'pointer',
                              }}
                            >
                              Batal
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(biz.id)}
                            style={{
                              padding: '4px 10px', borderRadius: 4, border: '1px solid #2d1515',
                              background: 'transparent', color: '#ef4444', fontSize: 11, cursor: 'pointer',
                            }}
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
