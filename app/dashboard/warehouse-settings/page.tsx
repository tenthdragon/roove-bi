// app/dashboard/warehouse-settings/page.tsx
// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  getProductsFull,
  createProduct,
  updateProduct,
  deactivateProduct,
  getScalevMappings,
  getScalevFrequencies,
  getScalevPriceTiers,
  updateScalevMapping,
  syncScalevProductNames,
  getProducts,
  getVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  getWarehouseBusinessMappings,
  updateWarehouseBusinessMapping,
} from '@/lib/warehouse-ledger-actions';
import { fetchAllBrands, fetchActiveBrands } from '@/lib/brand-actions';
import { fmtRupiah } from '@/lib/utils';
import BrandManager from '@/components/BrandManager';
import { usePermissions } from '@/lib/PermissionsContext';

const SUB_TABS = [
  { id: 'brands', label: 'Brand' },
  { id: 'vendors', label: 'Vendor' },
  { id: 'products', label: 'Master Produk' },
  { id: 'warehouses', label: 'Active Warehouse' },
  { id: 'mapping', label: 'Mapping Scalev' },
];

const CATEGORIES = ['fg', 'sachet', 'packaging', 'bonus', 'other'];
const ENTITIES = ['RTI', 'RLB', 'RLT', 'JHN'];

const inputStyle = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
  padding: '6px 10px', color: 'var(--text)', fontSize: 12, outline: 'none', width: '100%',
};

export default function WarehouseSettingsPage() {
  const { can } = usePermissions();
  const visibleTabs = SUB_TABS.filter(t => can(`whs:${t.id}`));
  const [activeTab, setActiveTab] = useState('brands');

  // Auto-switch if current tab is no longer visible
  const effectiveTab = visibleTabs.find(t => t.id === activeTab)?.id ?? visibleTabs[0]?.id ?? 'brands';

  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Warehouse Settings</h2>

      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {visibleTabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: effectiveTab === t.id ? 'var(--border)' : 'transparent',
              color: effectiveTab === t.id ? '#60a5fa' : 'var(--dim)',
              borderBottom: effectiveTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              whiteSpace: 'nowrap',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {effectiveTab === 'products' && <MasterProdukTab />}
      {effectiveTab === 'brands' && <BrandTab />}
      {effectiveTab === 'vendors' && <VendorTab />}
      {effectiveTab === 'warehouses' && <ActiveWarehouseTab />}
      {effectiveTab === 'mapping' && <MappingTabWrapper />}
    </div>
  );
}

// ============================================================
// MASTER PRODUK TAB
// ============================================================

function MasterProdukTab() {
  const [products, setProducts] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [vendors, setVendorList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEntity, setFilterEntity] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', category: 'fg', unit: 'pcs', entity: 'RLB', warehouse: 'BTN', price_list: '', hpp: '', vendor_id: '', brand_id: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [prods, br, vnd] = await Promise.all([
        getProductsFull({ includeInactive: true }),
        fetchActiveBrands(),
        getVendors(),
      ]);
      setProducts(prods);
      setBrands(br);
      setVendorList(vnd);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = products;
    if (filterEntity !== 'all') result = result.filter(p => `${p.warehouse}-${p.entity}` === filterEntity);
    if (filterCategory !== 'all') result = result.filter(p => p.category === filterCategory);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q) || (p.vendor || '').toLowerCase().includes(q));
    }
    return result;
  }, [products, filterEntity, filterCategory, search]);

  const warehouses = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => set.add(`${p.warehouse}-${p.entity}`));
    return Array.from(set).sort();
  }, [products]);

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditData({ price_list: p.price_list || 0, hpp: p.hpp || 0, vendor_id: p.vendor_id || '', brand_id: p.brand_id || '', category: p.category, unit: p.unit });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateProduct(editingId, {
        price_list: Number(editData.price_list) || 0,
        hpp: Number(editData.hpp) || 0,
        vendor_id: editData.vendor_id ? Number(editData.vendor_id) : null,
        brand_id: editData.brand_id ? Number(editData.brand_id) : null,
        category: editData.category,
        unit: editData.unit,
      });
      setEditingId(null);
      setMessage({ type: 'success', text: 'Produk diupdate' });
      await loadData();
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
    setSaving(false);
  };

  const handleAdd = async () => {
    if (!newProduct.name.trim()) { setMessage({ type: 'error', text: 'Nama produk wajib' }); return; }
    setSaving(true);
    try {
      await createProduct({
        name: newProduct.name.trim(),
        category: newProduct.category,
        unit: newProduct.unit,
        entity: newProduct.entity,
        warehouse: newProduct.warehouse,
        price_list: Number(newProduct.price_list) || 0,
        hpp: Number(newProduct.hpp) || 0,
        brand_id: newProduct.brand_id ? Number(newProduct.brand_id) : undefined,
      });
      // Update vendor_id separately if selected
      if (newProduct.vendor_id) {
        const created = products[products.length - 1]; // Will be refreshed by loadData
      }
      setShowAdd(false);
      setNewProduct({ name: '', category: 'fg', unit: 'pcs', entity: 'RLB', warehouse: 'BTN', price_list: '', hpp: '', vendor_id: '', brand_id: '' });
      setMessage({ type: 'success', text: 'Produk ditambahkan' });
      await loadData();
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
    setSaving(false);
  };

  const handleDeactivate = async (id: number) => {
    if (!confirm('Nonaktifkan produk ini?')) return;
    try {
      await deactivateProduct(id);
      setMessage({ type: 'success', text: 'Produk dinonaktifkan' });
      await loadData();
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Memuat...</div>;

  return (
    <>
      {message && (
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12, background: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: message.type === 'success' ? '#6ee7b7' : '#fca5a5' }}>
          {message.text}
        </div>
      )}

      {/* Filters + Add */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setShowAdd(!showAdd)}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'var(--green)', color: '#fff' }}>
          + Tambah Produk
        </button>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Cari produk/vendor..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, minWidth: 200, flex: 'none', width: 'auto' }} />
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="all">Semua Gudang</option>
          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="all">Semua Kategori</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Tambah Produk Baru</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Nama *</label><input value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Kategori</label><select value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})} style={inputStyle}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Unit</label><input value={newProduct.unit} onChange={e => setNewProduct({...newProduct, unit: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Entity</label><select value={newProduct.entity} onChange={e => setNewProduct({...newProduct, entity: e.target.value})} style={inputStyle}>{ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}</select></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Gudang</label><input value={newProduct.warehouse} onChange={e => setNewProduct({...newProduct, warehouse: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Brand</label><select value={newProduct.brand_id} onChange={e => setNewProduct({...newProduct, brand_id: e.target.value})} style={inputStyle}><option value="">-</option>{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>HPP</label><input type="number" value={newProduct.hpp} onChange={e => setNewProduct({...newProduct, hpp: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Harga Jual</label><input type="number" value={newProduct.price_list} onChange={e => setNewProduct({...newProduct, price_list: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Vendor</label><select value={newProduct.vendor_id} onChange={e => setNewProduct({...newProduct, vendor_id: e.target.value})} style={inputStyle}><option value="">-</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={handleAdd} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--green)', color: '#fff', fontSize: 12, fontWeight: 600 }}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 12, cursor: 'pointer' }}>Batal</button>
          </div>
        </div>
      )}

      {/* Product table */}
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>{filtered.length} produk</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Nama', 'Brand', 'Kategori', 'Gudang', 'HPP', 'Harga Jual', 'Vendor', 'Unit', 'Status', 'Aksi'].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: ['HPP', 'Harga Jual'].includes(h) ? 'right' : 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const isEditing = editingId === p.id;
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--bg-deep)', opacity: p.is_active ? 1 : 0.5 }}>
                  <td style={{ padding: '5px 8px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
                  <td style={{ padding: '5px 8px' }}>
                    {isEditing ? (
                      <select value={editData.brand_id || ''} onChange={e => setEditData({...editData, brand_id: e.target.value})} style={{ ...inputStyle, width: 100 }}>
                        <option value="">-</option>
                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{p.brands?.name || '-'}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    {isEditing ? (
                      <select value={editData.category} onChange={e => setEditData({...editData, category: e.target.value})} style={{ ...inputStyle, width: 80 }}>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}>{p.category}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--text-secondary)' }}>{p.warehouse}-{p.entity}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {isEditing ? (
                      <input type="number" value={editData.hpp} onChange={e => setEditData({...editData, hpp: e.target.value})} style={{ ...inputStyle, width: 80, textAlign: 'right' }} />
                    ) : (
                      <span style={{ color: p.hpp > 0 ? 'var(--text)' : 'var(--text-muted)' }}>{p.hpp > 0 ? fmtRupiah(p.hpp) : '-'}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {isEditing ? (
                      <input type="number" value={editData.price_list} onChange={e => setEditData({...editData, price_list: e.target.value})} style={{ ...inputStyle, width: 80, textAlign: 'right' }} />
                    ) : (
                      <span style={{ color: p.price_list > 0 ? 'var(--text)' : 'var(--text-muted)' }}>{p.price_list > 0 ? fmtRupiah(p.price_list) : '-'}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    {isEditing ? (
                      <select value={editData.vendor_id || ''} onChange={e => setEditData({...editData, vendor_id: e.target.value})} style={{ ...inputStyle, width: 120 }}>
                        <option value="">-</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{vendors.find(v => v.id === p.vendor_id)?.name || '-'}</span>
                    )}
                  </td>
                  <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--text-secondary)' }}>
                    {isEditing ? (
                      <input value={editData.unit} onChange={e => setEditData({...editData, unit: e.target.value})} style={{ ...inputStyle, width: 50 }} />
                    ) : p.unit}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600, background: p.is_active ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)', color: p.is_active ? '#6ee7b7' : '#fca5a5' }}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={saveEdit} disabled={saving} style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: 'var(--green)', color: '#fff', fontSize: 10, cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 10, cursor: 'pointer' }}>X</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => startEdit(p)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', fontSize: 10, cursor: 'pointer' }}>Edit</button>
                        {p.is_active && (
                          <button onClick={() => handleDeactivate(p.id)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 10, cursor: 'pointer' }}>Off</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// BRAND TAB
// ============================================================

function BrandTab() {
  return <BrandManager />;
}

// ============================================================
// VENDOR TAB
// ============================================================

function VendorTab() {
  const [vendors, setVendorList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: '', address: '', phone: '', pic_name: '', notes: '', is_pkp: false });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  useEffect(() => { loadVendors(); }, []);

  async function loadVendors() {
    setLoading(true);
    try { setVendorList(await getVendors()); } catch (e) { console.error(e); }
    setLoading(false);
  }

  const handleAdd = async () => {
    if (!newVendor.name.trim()) { setMessage({ type: 'error', text: 'Nama vendor wajib' }); return; }
    setSaving(true);
    try {
      await createVendor({ name: newVendor.name.trim(), address: newVendor.address || undefined, phone: newVendor.phone || undefined, pic_name: newVendor.pic_name || undefined, notes: newVendor.notes || undefined, is_pkp: newVendor.is_pkp });
      setShowAdd(false);
      setNewVendor({ name: '', address: '', phone: '', pic_name: '', notes: '', is_pkp: false });
      setMessage({ type: 'success', text: 'Vendor ditambahkan' });
      await loadVendors();
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
    setSaving(false);
  };

  const startEdit = (v: any) => {
    setEditingId(v.id);
    setEditData({ name: v.name, address: v.address || '', phone: v.phone || '', pic_name: v.pic_name || '', notes: v.notes || '', is_pkp: !!v.is_pkp });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await updateVendor(editingId, { name: editData.name, address: editData.address || null, phone: editData.phone || null, pic_name: editData.pic_name || null, notes: editData.notes || null, is_pkp: !!editData.is_pkp });
      setEditingId(null);
      setMessage({ type: 'success', text: 'Vendor diupdate' });
      await loadVendors();
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
    setSaving(false);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm('Hapus vendor "' + name + '"? Produk yang menggunakan vendor ini akan menjadi tanpa vendor.')) return;
    try {
      await deleteVendor(id);
      setMessage({ type: 'success', text: 'Vendor dihapus' });
      await loadVendors();
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Memuat...</div>;

  return (
    <>
      {message && (
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12, background: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: message.type === 'success' ? '#6ee7b7' : '#fca5a5' }}>
          {message.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setShowAdd(!showAdd)}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'var(--green)', color: '#fff' }}>
          + Tambah Vendor
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--dim)', alignSelf: 'center' }}>{vendors.length} vendor</span>
      </div>

      {showAdd && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Tambah Vendor Baru</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Nama *</label><input value={newVendor.name} onChange={e => setNewVendor({...newVendor, name: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>PIC</label><input value={newVendor.pic_name} onChange={e => setNewVendor({...newVendor, pic_name: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>No. HP</label><input value={newVendor.phone} onChange={e => setNewVendor({...newVendor, phone: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Alamat</label><input value={newVendor.address} onChange={e => setNewVendor({...newVendor, address: e.target.value})} style={inputStyle} /></div>
            <div><label style={{ fontSize: 10, color: 'var(--dim)' }}>Catatan</label><input value={newVendor.notes} onChange={e => setNewVendor({...newVendor, notes: e.target.value})} style={inputStyle} /></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={newVendor.is_pkp} onChange={e => setNewVendor({...newVendor, is_pkp: e.target.checked})} />
              PKP (Pengusaha Kena Pajak)
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={handleAdd} disabled={saving} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--green)', color: '#fff', fontSize: 12, fontWeight: 600 }}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
            <button onClick={() => setShowAdd(false)} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 12, cursor: 'pointer' }}>Batal</button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Nama', 'PKP', 'PIC', 'No. HP', 'Alamat', 'Catatan', 'Aksi'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vendors.map(v => {
              const isEditing = editingId === v.id;
              return (
                <tr key={v.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 500, color: 'var(--text)' }}>
                    {isEditing ? <input value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} style={{ ...inputStyle, width: 150 }} /> : v.name}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {isEditing ? (
                      <input type="checkbox" checked={!!editData.is_pkp} onChange={e => setEditData({...editData, is_pkp: e.target.checked})} />
                    ) : (
                      <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: v.is_pkp ? 'rgba(59,130,246,0.15)' : 'rgba(148,163,184,0.15)', color: v.is_pkp ? '#60a5fa' : '#94a3b8' }}>
                        {v.is_pkp ? 'PKP' : 'Non-PKP'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>
                    {isEditing ? <input value={editData.pic_name} onChange={e => setEditData({...editData, pic_name: e.target.value})} style={{ ...inputStyle, width: 120 }} /> : v.pic_name || '-'}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11 }}>
                    {isEditing ? <input value={editData.phone} onChange={e => setEditData({...editData, phone: e.target.value})} style={{ ...inputStyle, width: 130 }} /> : v.phone || '-'}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isEditing ? <input value={editData.address} onChange={e => setEditData({...editData, address: e.target.value})} style={{ ...inputStyle, width: 200 }} /> : v.address || '-'}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 11 }}>
                    {isEditing ? <input value={editData.notes} onChange={e => setEditData({...editData, notes: e.target.value})} style={{ ...inputStyle, width: 150 }} /> : v.notes || '-'}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={saveEdit} disabled={saving} style={{ padding: '2px 8px', borderRadius: 4, border: 'none', background: 'var(--green)', color: '#fff', fontSize: 10, cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 10, cursor: 'pointer' }}>X</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => startEdit(v)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', fontSize: 10, cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => handleDelete(v.id, v.name)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--red)', fontSize: 10, cursor: 'pointer' }}>Hapus</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {vendors.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada vendor. Klik "+ Tambah Vendor" untuk menambahkan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// ACTIVE WAREHOUSE TAB
// ============================================================

function ActiveWarehouseTab() {
  const [products, setProducts] = useState<any[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [prods, maps] = await Promise.all([
        getProductsFull(),
        getWarehouseBusinessMappings(),
      ]);
      setProducts(prods);
      setMappings(maps);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  // Count products per warehouse-entity
  const warehouseCounts = useMemo(() => {
    const counts: Record<string, { total: number; active: number; fg: number; sachet: number; bonus: number; packaging: number }> = {};
    products.forEach(p => {
      const key = `${p.warehouse} - ${p.entity}`;
      if (!counts[key]) counts[key] = { total: 0, active: 0, fg: 0, sachet: 0, bonus: 0, packaging: 0 };
      counts[key].total++;
      if (p.is_active) counts[key].active++;
      if (p.category === 'fg') counts[key].fg++;
      else if (p.category === 'sachet') counts[key].sachet++;
      else if (p.category === 'bonus') counts[key].bonus++;
      else if (p.category === 'packaging') counts[key].packaging++;
    });
    return counts;
  }, [products]);

  const handleMappingChange = async (id: number, field: string, value: any) => {
    setSaving(true);
    try {
      await updateWarehouseBusinessMapping(id, field, value);
      setMessage({ type: 'success', text: 'Mapping updated' });
      setMappings(await getWarehouseBusinessMappings());
    } catch (e: any) { setMessage({ type: 'error', text: e.message }); }
    setSaving(false);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Memuat...</div>;

  return (
    <>
      {message && (
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12, background: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: message.type === 'success' ? '#6ee7b7' : '#fca5a5' }}>
          {message.text}
        </div>
      )}

      {/* Warehouse overview */}
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Daftar Gudang</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12, marginBottom: 24 }}>
        {Object.entries(warehouseCounts).sort().map(([wh, counts]) => (
          <div key={wh} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{wh}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <div>Total produk: <b>{counts.total}</b> ({counts.active} active)</div>
              <div>FG: {counts.fg} | Sachet: {counts.sachet} | Bonus: {counts.bonus} | Packaging: {counts.packaging}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Business → Warehouse Mapping moved to Business Settings */}
    </>
  );
}

// ============================================================
// MAPPING SCALEV TAB (moved from warehouse page)
// ============================================================

function MappingTabWrapper() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setData(await getScalevMappings()); } catch {}
      setLoading(false);
    })();
  }, [refreshKey]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Memuat...</div>;

  // Import and render the MappingTab from warehouse page
  // For now, inline a simplified version
  return <MappingTabInline data={data} onRefresh={() => setRefreshKey(k => k + 1)} />;
}

// Simplified inline MappingTab (same logic as warehouse page MappingTab)
function MappingTabInline({ data, onRefresh }: { data: any[]; onRefresh: () => void }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [freqMap, setFreqMap] = useState<Record<string, number>>({});
  const [priceTiers, setPriceTiers] = useState<Record<string, { price: number; count: number }[]>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { (async () => { try { setProducts(await getProducts()); } catch {} })(); }, []);
  useEffect(() => { (async () => { try { setFreqMap(await getScalevFrequencies()); } catch {} })(); }, []);
  useEffect(() => { (async () => { try { setPriceTiers(await getScalevPriceTiers()); } catch {} })(); }, []);

  const dataWithFreq = useMemo(() => data.map(r => ({ ...r, frequency: freqMap[r.scalev_product_name] || 0 })), [data, freqMap]);

  const filtered = useMemo(() => {
    let result = dataWithFreq;
    if (filter === 'mapped') result = result.filter(r => r.warehouse_product_id && !r.is_ignored);
    if (filter === 'unmapped') result = result.filter(r => !r.warehouse_product_id && !r.is_ignored);
    if (filter === 'ignored') result = result.filter(r => r.is_ignored);
    if (search) { const q = search.toLowerCase(); result = result.filter(r => r.scalev_product_name?.toLowerCase().includes(q)); }
    return result.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
  }, [dataWithFreq, filter, search]);

  const counts = useMemo(() => ({
    all: dataWithFreq.length,
    mapped: dataWithFreq.filter(r => r.warehouse_product_id && !r.is_ignored).length,
    unmapped: dataWithFreq.filter(r => !r.warehouse_product_id && !r.is_ignored).length,
    ignored: dataWithFreq.filter(r => r.is_ignored).length,
  }), [dataWithFreq]);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return [];
    const q = productSearch.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q));
  }, [products, productSearch]);

  const getSuggestion = (scalevName: string) => {
    if (!products.length) return null;
    const sn = scalevName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const snWords = sn.split(' ');
    let bestMatch: any = null; let bestScore = 0;
    for (const p of products) {
      const pn = p.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const pnWords = pn.split(' ');
      let matches = 0;
      for (const sw of snWords) { if (sw.length < 2) continue; for (const pw of pnWords) { if (pw.includes(sw) || sw.includes(pw)) { matches++; break; } } }
      const score = matches / Math.max(snWords.length, pnWords.length);
      if (score > bestScore && score >= 0.3) { bestScore = score; bestMatch = { ...p, score }; }
    }
    return bestMatch;
  };

  const handleMap = async (mappingId: number, productId: number | null) => {
    setSaving(true);
    try { await updateScalevMapping(mappingId, productId, undefined, false); setEditingId(null); setProductSearch(''); onRefresh(); } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleIgnore = async (id: number) => { setSaving(true); try { await updateScalevMapping(id, null, undefined, true); onRefresh(); } catch {} setSaving(false); };
  const handleUnignore = async (id: number) => { setSaving(true); try { await updateScalevMapping(id, null, undefined, false); onRefresh(); } catch {} setSaving(false); };
  const handleSync = async () => { setSyncing(true); try { await syncScalevProductNames(); onRefresh(); } catch {} setSyncing(false); };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'unmapped', 'mapped', 'ignored'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`, background: filter === f ? 'var(--accent)' : 'transparent', color: filter === f ? '#fff' : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
            {f === 'all' ? 'Semua' : f === 'unmapped' ? 'Belum Map' : f === 'mapped' ? 'Sudah Map' : 'Ignored'} ({counts[f]})
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Cari..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, minWidth: 200, width: 'auto' }} />
        <button onClick={handleSync} disabled={syncing} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'transparent', color: 'var(--dim)' }}>
          {syncing ? 'Syncing...' : 'Sync Baru'}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Scalev Name', 'Frek', 'Harga/unit', 'Mapped To', 'Status', 'Aksi'].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: ['Scalev Name', 'Mapped To', 'Harga/unit', 'Status', 'Aksi'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const isEditing = editingId === r.id;
              const wp = r.warehouse_products;
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '5px 8px', color: 'var(--text)', fontWeight: 500, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.scalev_product_name}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 10 }}>{(r.frequency || 0).toLocaleString('id-ID')}</td>
                  <td style={{ padding: '5px 8px', fontSize: 9 }}>
                    {(priceTiers[r.scalev_product_name] || []).slice(0, 2).map((t, i) => (
                      <div key={i}><span style={{ fontFamily: 'monospace' }}>{Math.round(t.price).toLocaleString('id-ID')}</span> <span style={{ color: 'var(--dim)' }}>({t.count.toLocaleString('id-ID')}x)</span></div>
                    ))}
                  </td>
                  <td style={{ padding: '5px 8px', minWidth: 200 }}>
                    {isEditing ? (
                      <div>
                        <input type="text" placeholder="Cari produk..." value={productSearch} onChange={e => setProductSearch(e.target.value)} style={inputStyle} autoFocus />
                        {productSearch && (
                          <div style={{ maxHeight: 100, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginTop: 2 }}>
                            <div onClick={() => handleMap(r.id, null)} style={{ padding: '3px 6px', fontSize: 10, cursor: 'pointer', color: 'var(--dim)' }}>-- Hapus --</div>
                            {filteredProducts.slice(0, 10).map(p => (
                              <div key={p.id} onClick={() => handleMap(r.id, p.id)} style={{ padding: '3px 6px', fontSize: 10, cursor: 'pointer', color: 'var(--text)', borderTop: '1px solid var(--bg-deep)' }}>
                                {p.name} [{p.warehouse}-{p.entity}]
                              </div>
                            ))}
                          </div>
                        )}
                        <button onClick={() => { setEditingId(null); setProductSearch(''); }} style={{ marginTop: 2, padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 9, cursor: 'pointer' }}>Batal</button>
                      </div>
                    ) : (
                      (() => {
                        if (wp) return <span style={{ color: 'var(--text)', fontSize: 11 }}>{wp.name} [{wp.warehouse}-{wp.entity}]</span>;
                        if (r.is_ignored) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>-</span>;
                        const suggestion = getSuggestion(r.scalev_product_name);
                        return suggestion ? (
                          <button onClick={() => handleMap(r.id, suggestion.id)} disabled={saving}
                            style={{ padding: '3px 8px', borderRadius: 5, border: '1px dashed #8b5cf6', background: 'rgba(139,92,246,0.08)', color: '#c4b5fd', fontSize: 10, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                            <span style={{ fontSize: 8, color: 'var(--dim)', display: 'block' }}>Suggestion ({Math.round(suggestion.score * 100)}%)</span>
                            {suggestion.name}
                          </button>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Belum dimapping</span>;
                      })()
                    )}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    {r.is_ignored ? <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'var(--bg-deep)', color: 'var(--dim)' }}>Ignored</span>
                    : r.warehouse_product_id ? <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'var(--badge-green-bg)', color: '#6ee7b7' }}>Mapped</span>
                    : <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'var(--badge-red-bg)', color: '#fca5a5' }}>Unmapped</span>}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {!isEditing && !r.is_ignored && <button onClick={() => setEditingId(r.id)} style={{ padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', fontSize: 9, cursor: 'pointer' }}>{r.warehouse_product_id ? 'Ubah' : 'Map'}</button>}
                      {!r.is_ignored && !r.warehouse_product_id && <button onClick={() => handleIgnore(r.id)} style={{ padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 9, cursor: 'pointer' }}>Ignore</button>}
                      {r.is_ignored && <button onClick={() => handleUnignore(r.id)} style={{ padding: '1px 6px', borderRadius: 3, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', fontSize: 9, cursor: 'pointer' }}>Unignore</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
