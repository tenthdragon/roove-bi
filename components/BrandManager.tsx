'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addBrand,
  addBrandAlias,
  getBrandCatalogSnapshot,
  saveBrandBusinessRoles,
  setBrandAliasActive,
  toggleBrand,
  updateBrandKeywords,
  type Brand,
  type BrandAlias,
  type BrandCatalogSnapshot,
} from '@/lib/brand-actions';

type Message = { type: 'success' | 'error'; text: string };
type RoleDraft = {
  brandId: number;
  ownerBusinessId: string;
  sellerBusinessIds: number[];
};

const EMPTY_ALIAS = {
  provider: 'generic',
  aliasType: 'store' as BrandAlias['alias_type'],
  alias: '',
  notes: '',
};

const PROVIDERS = [
  { value: 'generic', label: 'Generic' },
  { value: 'meta', label: 'Meta' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'scalev', label: 'Scalev' },
  { value: 'spreadsheet', label: 'Spreadsheet' },
];

const ALIAS_TYPES: Array<{ value: BrandAlias['alias_type']; label: string }> = [
  { value: 'store', label: 'Store / akun' },
  { value: 'product', label: 'Produk eksternal' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'other', label: 'Lainnya' },
];

const inputStyle = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 12,
  outline: 'none',
};

const labelStyle = {
  display: 'block',
  marginBottom: 4,
  color: 'var(--dim)',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
};

export default function BrandManager() {
  const [snapshot, setSnapshot] = useState<BrandCatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newSheet, setNewSheet] = useState('');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [expandedBrandId, setExpandedBrandId] = useState<number | null>(null);
  const [editingKeywords, setEditingKeywords] = useState<{ id: number; keywords: string } | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [aliasDraft, setAliasDraft] = useState(EMPTY_ALIAS);
  const [savingDetail, setSavingDetail] = useState(false);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await getBrandCatalogSnapshot());
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal memuat master brand.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const activeBrands = useMemo(
    () => (snapshot?.brands || []).filter(brand => brand.is_active),
    [snapshot?.brands],
  );
  const inactiveBrands = useMemo(
    () => (snapshot?.brands || []).filter(brand => !brand.is_active),
    [snapshot?.brands],
  );

  const unresolved = useMemo(
    () => (snapshot?.audit || []).reduce((sum, row) => sum + row.unresolved, 0),
    [snapshot?.audit],
  );

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) {
      setMessage({ type: 'error', text: 'Nama brand wajib diisi.' });
      return;
    }

    setAdding(true);
    setMessage(null);
    try {
      const result = await addBrand(name, newSheet.trim() || name);
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || 'Brand tidak dapat ditambahkan.' });
        return;
      }
      setNewName('');
      setNewSheet('');
      setMessage({ type: 'success', text: `Brand “${name}” ditambahkan ke master canonical.` });
      await loadSnapshot();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menambahkan brand.' });
    } finally {
      setAdding(false);
    }
  };

  const openBrand = (brand: Brand) => {
    if (expandedBrandId === brand.id) {
      setExpandedBrandId(null);
      setRoleDraft(null);
      return;
    }

    const roles = (snapshot?.roles || []).filter(role => role.brand_id === brand.id && role.is_active);
    setExpandedBrandId(brand.id);
    setRoleDraft({
      brandId: brand.id,
      ownerBusinessId: String(roles.find(role => role.role === 'owner')?.business_id || ''),
      sellerBusinessIds: roles.filter(role => role.role === 'seller').map(role => role.business_id),
    });
    setAliasDraft(EMPTY_ALIAS);
    setEditingKeywords(null);
  };

  const saveKeywords = async () => {
    if (!editingKeywords) return;
    setSavingDetail(true);
    try {
      await updateBrandKeywords(editingKeywords.id, editingKeywords.keywords);
      setEditingKeywords(null);
      setMessage({ type: 'success', text: 'Keywords brand disimpan.' });
      await loadSnapshot();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan keywords.' });
    } finally {
      setSavingDetail(false);
    }
  };

  const saveRoles = async () => {
    if (!roleDraft) return;
    setSavingDetail(true);
    try {
      await saveBrandBusinessRoles({
        brandId: roleDraft.brandId,
        ownerBusinessId: roleDraft.ownerBusinessId ? Number(roleDraft.ownerBusinessId) : null,
        sellerBusinessIds: roleDraft.sellerBusinessIds,
      });
      setMessage({ type: 'success', text: 'Relasi owner dan seller brand disimpan.' });
      await loadSnapshot();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan relasi business.' });
    } finally {
      setSavingDetail(false);
    }
  };

  const saveAlias = async () => {
    if (!expandedBrandId || !aliasDraft.alias.trim()) {
      setMessage({ type: 'error', text: 'Alias wajib diisi.' });
      return;
    }
    setSavingDetail(true);
    try {
      await addBrandAlias({
        brandId: expandedBrandId,
        provider: aliasDraft.provider,
        aliasType: aliasDraft.aliasType,
        alias: aliasDraft.alias,
        notes: aliasDraft.notes,
      });
      setAliasDraft(EMPTY_ALIAS);
      setMessage({ type: 'success', text: 'Alias eksternal disimpan.' });
      await loadSnapshot();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal menyimpan alias.' });
    } finally {
      setSavingDetail(false);
    }
  };

  const toggleAlias = async (alias: BrandAlias) => {
    try {
      await setBrandAliasActive(alias.id, !alias.is_active);
      await loadSnapshot();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal mengubah status alias.' });
    }
  };

  const toggleBrandStatus = async (brand: Brand) => {
    try {
      await toggleBrand(brand.id, !brand.is_active);
      setMessage({
        type: 'success',
        text: brand.is_active
          ? `Brand “${brand.name}” dinonaktifkan tanpa menghapus histori.`
          : `Brand “${brand.name}” diaktifkan.`,
      });
      await loadSnapshot();
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Gagal mengubah status brand.' });
    }
  };

  if (loading && !snapshot) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Memuat catalog brand...</div>;
  }

  const renderBrandCard = (brand: Brand) => {
    const roles = (snapshot?.roles || []).filter(role => role.brand_id === brand.id && role.is_active);
    const aliases = (snapshot?.aliases || []).filter(alias => alias.brand_id === brand.id);
    const ownerRole = roles.find(role => role.role === 'owner');
    const owner = snapshot?.businesses.find(business => business.id === ownerRole?.business_id);
    const sellers = roles
      .filter(role => role.role === 'seller')
      .map(role => snapshot?.businesses.find(business => business.id === role.business_id))
      .filter(Boolean);
    const usage = snapshot?.usage[brand.id] || { products: 0, metaAccounts: 0, wabaAccounts: 0 };
    const expanded = expandedBrandId === brand.id;

    return (
      <div key={brand.id} style={{ background: 'var(--card)', border: `1px solid ${expanded ? 'rgba(59,130,246,.45)' : 'var(--border)'}`, borderRadius: 12, overflow: 'hidden', opacity: brand.is_active ? 1 : 0.72 }}>
        <button
          type="button"
          onClick={() => openBrand(brand)}
          style={{ width: '100%', padding: '13px 15px', border: 'none', background: 'transparent', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
        >
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{brand.name}</span>
              <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: brand.is_active ? 'var(--badge-green-bg)' : 'var(--border)', color: brand.is_active ? 'var(--green)' : 'var(--dim)' }}>
                {brand.is_active ? 'Active' : 'Inactive'}
              </span>
              {!owner && <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'var(--badge-yellow-bg)', color: 'var(--yellow)' }}>Owner belum diatur</span>}
            </div>
            <div style={{ marginTop: 4, color: 'var(--dim)', fontSize: 11 }}>
              Owner: {owner ? `${owner.business_code} · ${owner.business_name}` : '—'} · Seller: {sellers.length || 0}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--dim)', fontSize: 10 }}>{usage.products} produk</span>
            <span style={{ color: 'var(--dim)', fontSize: 10 }}>{usage.metaAccounts} Meta</span>
            <span style={{ color: 'var(--dim)', fontSize: 10 }}>{aliases.filter(alias => alias.is_active).length} alias</span>
          </div>
          <span style={{ color: 'var(--dim)', fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
        </button>

        {expanded && roleDraft?.brandId === brand.id && (
          <div style={{ borderTop: '1px solid var(--border)', padding: 15, display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
              <section style={{ padding: 13, borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Identitas Canonical</div>
                <div style={{ color: 'var(--dim)', fontSize: 11, marginBottom: 8 }}>Sheet: <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{brand.sheet_name}</span></div>
                {editingKeywords?.id === brand.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={editingKeywords.keywords} onChange={event => setEditingKeywords({ id: brand.id, keywords: event.target.value })} style={inputStyle} placeholder={brand.name.toLowerCase()} />
                    <button onClick={saveKeywords} disabled={savingDetail} style={{ border: 'none', borderRadius: 6, padding: '6px 11px', background: 'var(--green)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>Simpan</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--dim)', fontSize: 11 }}>Keywords:</span>
                    <code style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{brand.keywords || brand.name.toLowerCase()}</code>
                    <button onClick={() => setEditingKeywords({ id: brand.id, keywords: brand.keywords || '' })} style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '3px 8px', background: 'transparent', color: 'var(--accent)', fontSize: 10, cursor: 'pointer' }}>Edit</button>
                  </div>
                )}
              </section>

              <section style={{ padding: 13, borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Business Owner &amp; Seller</div>
                <label style={labelStyle}>Pemilik utama</label>
                <select value={roleDraft.ownerBusinessId} onChange={event => setRoleDraft({ ...roleDraft, ownerBusinessId: event.target.value })} style={inputStyle}>
                  <option value="">— Belum ditetapkan —</option>
                  {(snapshot?.businesses || []).map(business => <option key={business.id} value={business.id}>{business.business_code} · {business.business_name}</option>)}
                </select>
                <div style={{ ...labelStyle, marginTop: 10 }}>Business yang boleh menjual</div>
                <div style={{ display: 'grid', gap: 5, maxHeight: 145, overflowY: 'auto' }}>
                  {(snapshot?.businesses || []).map(business => {
                    const checked = roleDraft.sellerBusinessIds.includes(business.id);
                    return (
                      <label key={business.id} style={{ display: 'flex', gap: 7, alignItems: 'center', color: business.is_active ? 'var(--text-secondary)' : 'var(--dim)', fontSize: 11 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setRoleDraft({
                            ...roleDraft,
                            sellerBusinessIds: checked
                              ? roleDraft.sellerBusinessIds.filter(id => id !== business.id)
                              : [...roleDraft.sellerBusinessIds, business.id],
                          })}
                        />
                        {business.business_code} · {business.business_name}
                      </label>
                    );
                  })}
                </div>
                <button onClick={saveRoles} disabled={savingDetail} style={{ marginTop: 10, border: 'none', borderRadius: 6, padding: '6px 12px', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Simpan Relasi</button>
              </section>
            </div>

            <section style={{ padding: 13, borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>External Aliases</div>
                  <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 3 }}>Nama dari Meta, Scalev, spreadsheet, atau sumber lain yang mengarah ke brand ini.</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 7, alignItems: 'end' }}>
                <div><label style={labelStyle}>Provider</label><select value={aliasDraft.provider} onChange={event => setAliasDraft({ ...aliasDraft, provider: event.target.value })} style={inputStyle}>{PROVIDERS.map(provider => <option key={provider.value} value={provider.value}>{provider.label}</option>)}</select></div>
                <div><label style={labelStyle}>Jenis</label><select value={aliasDraft.aliasType} onChange={event => setAliasDraft({ ...aliasDraft, aliasType: event.target.value as BrandAlias['alias_type'] })} style={inputStyle}>{ALIAS_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
                <div><label style={labelStyle}>Alias</label><input value={aliasDraft.alias} onChange={event => setAliasDraft({ ...aliasDraft, alias: event.target.value })} style={inputStyle} placeholder="Contoh: Plume" /></div>
                <div><label style={labelStyle}>Catatan</label><input value={aliasDraft.notes} onChange={event => setAliasDraft({ ...aliasDraft, notes: event.target.value })} style={inputStyle} placeholder="Opsional" /></div>
                <button onClick={saveAlias} disabled={savingDetail} style={{ border: 'none', borderRadius: 6, padding: '7px 12px', background: 'var(--green)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ Alias</button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {aliases.map(alias => (
                  <button key={alias.id} onClick={() => toggleAlias(alias)} title="Klik untuk mengaktifkan/nonaktifkan" style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', background: alias.is_active ? 'var(--card)' : 'transparent', color: alias.is_active ? 'var(--text-secondary)' : 'var(--dim)', fontSize: 10, cursor: 'pointer', opacity: alias.is_active ? 1 : 0.55 }}>
                    {alias.provider} · {alias.alias_type} · <strong>{alias.alias}</strong>
                  </button>
                ))}
                {aliases.length === 0 && <span style={{ color: 'var(--dim)', fontSize: 11 }}>Belum ada alias.</span>}
              </div>
            </section>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ color: 'var(--dim)', fontSize: 11 }}>
                Brand canonical tidak dihapus permanen agar histori produk, iklan, dan ledger tetap dapat ditelusuri.
              </div>
              <button onClick={() => toggleBrandStatus(brand)} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 11px', background: 'transparent', color: brand.is_active ? 'var(--yellow)' : 'var(--green)', fontSize: 11, cursor: 'pointer' }}>
                {brand.is_active ? 'Nonaktifkan Brand' : 'Aktifkan Brand'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ padding: 16, borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Canonical Brand Registry</div>
            <div style={{ marginTop: 4, color: 'var(--dim)', fontSize: 11, lineHeight: 1.6 }}>Satu sumber brand untuk product catalog, business ownership, Meta, WABA, dan atribusi biaya iklan.</div>
          </div>
          <span style={{ padding: '3px 9px', borderRadius: 5, background: unresolved > 0 ? 'var(--badge-yellow-bg)' : 'var(--badge-green-bg)', color: unresolved > 0 ? 'var(--yellow)' : 'var(--green)', fontSize: 10, fontWeight: 700 }}>
            {unresolved > 0 ? `${unresolved.toLocaleString('id-ID')} relasi belum terselesaikan` : 'Semua relasi canonical terselesaikan'}
          </span>
        </div>
        {(snapshot?.audit || []).length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 6, marginTop: 12 }}>
            {(snapshot?.audit || []).map(row => (
              <div key={row.metric} style={{ padding: 8, borderRadius: 7, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ color: 'var(--dim)', fontSize: 9, textTransform: 'uppercase' }}>{row.metric.replaceAll('_', ' ')}</div>
                <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: row.unresolved > 0 ? 'var(--yellow)' : 'var(--text-secondary)' }}>{row.resolved}/{row.total} resolved</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: 16, borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Tambah Brand</div>
        <div style={{ color: 'var(--dim)', fontSize: 11, marginBottom: 10 }}>Brand baru langsung tersedia untuk product master dan Marketing APIs.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 1fr) auto', gap: 8, alignItems: 'end' }}>
          <div><label style={labelStyle}>Nama Brand *</label><input value={newName} onChange={event => setNewName(event.target.value)} style={inputStyle} placeholder="Contoh: NovaSkin" /></div>
          <div><label style={labelStyle}>Sheet Name</label><input value={newSheet} onChange={event => setNewSheet(event.target.value)} style={inputStyle} placeholder={newName || 'Default sama dengan brand'} /></div>
          <button onClick={handleAdd} disabled={adding} style={{ border: 'none', borderRadius: 7, padding: '8px 16px', background: adding ? 'var(--border)' : 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: adding ? 'wait' : 'pointer' }}>{adding ? 'Menambahkan...' : '+ Tambah Brand'}</button>
        </div>
        {message && <div onClick={() => setMessage(null)} style={{ marginTop: 10, padding: '8px 10px', borderRadius: 7, background: message.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: message.type === 'success' ? 'var(--green)' : 'var(--red)', fontSize: 11, cursor: 'pointer' }}>{message.text}</div>}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ color: 'var(--dim)', fontSize: 11 }}>{activeBrands.length} brand aktif · {inactiveBrands.length} inactive</div>
          <Link href="/dashboard/admin?tab=meta" style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>Buka Marketing APIs →</Link>
        </div>
        {activeBrands.map(renderBrandCard)}
        {inactiveBrands.length > 0 && <div style={{ marginTop: 5, color: 'var(--dim)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Brand Inactive</div>}
        {inactiveBrands.map(renderBrandCard)}
        {(snapshot?.brands || []).length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--dim)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>Belum ada brand canonical.</div>}
      </div>
    </div>
  );
}
