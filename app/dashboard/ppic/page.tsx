// app/dashboard/ppic/page.tsx
// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  getPurchaseOrders,
  getPurchaseOrderDetail,
  createPurchaseOrder,
  submitPurchaseOrder,
  cancelPurchaseOrder,
  receivePOItems,
  savePOCosts,
  getDemandPlans,
  getWeeklyDemandData,
  initDemandPlans,
  updateDemandPlan,
  getITOData,
  getROPAnalysis,
  updateProductROPConfig,
  getVendors,
  type POItem,
} from '@/lib/ppic-actions';
import { getProducts } from '@/lib/warehouse-ledger-actions';
import { getCurrentProfile } from '@/lib/actions';

// ── Helpers ──

function fmtDate(d: string | null) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtNum(n: number) {
  return n.toLocaleString('id-ID');
}

const ID_MONTHS = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  submitted: '#3b82f6',
  partial: '#f59e0b',
  completed: 'var(--green)',
  cancelled: 'var(--red)',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  partial: 'Partial',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// ── KPI Card ──

function KPICard({ label, value, color = 'var(--accent)', sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
      padding: 16, flex: 1, minWidth: 160,
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Status Badge ──

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: STATUS_COLORS[status] || '#94a3b8',
      color: '#fff',
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// ── Constants ──

const SUB_TABS = [
  { id: 'ito', label: 'Inventory Turn Over' },
  { id: 'rop', label: 'Reorder Point' },
  { id: 'demand', label: 'Demand Planning' },
  { id: 'po', label: 'Purchase Orders' },
];

const ENTITIES = ['BTN-RTI', 'BTN-RLB', 'BTN-JHN', 'BTN-RLT'];

// ============================================================
// MAIN PAGE
// ============================================================

export default function PPICPage() {
  const [activeTab, setActiveTab] = useState('ito');
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('');

  useEffect(() => {
    (async () => {
      const profile = await getCurrentProfile();
      if (profile) setUserRole(profile.role);
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ padding: '0 0 40px', position: 'relative' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Product Planning &amp; Inventory Control</h2>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: 'none', border: 'none', color: activeTab === t.id ? 'var(--accent)' : 'var(--dim)',
              borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'po' && <POTab />}
      {activeTab === 'demand' && <DemandTab />}
      {activeTab === 'ito' && <ITOTab />}
      {activeTab === 'rop' && <ROPTab />}
    </div>
  );
}

// ============================================================
// PO TAB
// ============================================================

function POTab() {
  const [pos, setPOs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState<number | null>(null);
  const [showDetailModal, setShowDetailModal] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await getPurchaseOrders(statusFilter !== 'all' ? { status: statusFilter } : undefined);
        setPOs(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [refreshKey, statusFilter]);

  const filtered = useMemo(() => {
    let result = pos;
    if (entityFilter !== 'all') result = result.filter(p => p.entity === entityFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.po_number?.toLowerCase().includes(q) ||
        p.warehouse_vendors?.name?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [pos, entityFilter, searchQuery]);

  const today = new Date().toISOString().slice(0, 10);
  const kpi = useMemo(() => {
    const total = pos.length;
    const pending = pos.filter(p => p.status === 'submitted').length;
    const partial = pos.filter(p => p.status === 'partial').length;
    const overdue = pos.filter(p =>
      ['submitted', 'partial'].includes(p.status) && p.expected_date && p.expected_date < today
    ).length;
    return { total, pending, partial, overdue };
  }, [pos, today]);

  const refresh = () => setRefreshKey(k => k + 1);

  return (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total PO" value={String(kpi.total)} color="var(--accent)" />
        <KPICard label="Submitted" value={String(kpi.pending)} color="#3b82f6" />
        <KPICard label="Partial" value={String(kpi.partial)} color="#f59e0b" />
        <KPICard label="Overdue" value={String(kpi.overdue)} color="var(--red)" />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Cari PO / Vendor..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', minWidth: 200 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="all">Semua Status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="partial">Partial</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="all">Semua Entity</option>
          {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowCreateModal(true)}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          + Buat PO
        </button>
      </div>

      {/* Table */}
      {loading ? <div style={{ color: 'var(--dim)', padding: 40, textAlign: 'center' }}>Memuat...</div> : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['PO#', 'Vendor', 'Entity', 'Tanggal PO', 'Exp. Delivery', 'Items', 'Status', 'Aksi'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--dim)' }}>Tidak ada PO</td></tr>
              ) : filtered.map(po => (
                <tr key={po.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{po.po_number}</td>
                  <td style={{ padding: '10px 12px' }}>{po.warehouse_vendors?.name || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>{po.entity}</td>
                  <td style={{ padding: '10px 12px' }}>{fmtDate(po.po_date)}</td>
                  <td style={{ padding: '10px 12px', color: po.expected_date && po.expected_date < today && ['submitted', 'partial'].includes(po.status) ? 'var(--red)' : 'inherit' }}>
                    {fmtDate(po.expected_date)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{po.warehouse_po_items?.length || 0} item</td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge status={po.status} /></td>
                  <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                    <button onClick={() => setShowDetailModal(po.id)}
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' }}>Detail</button>
                    {po.status === 'draft' && (
                      <button onClick={async () => { await submitPurchaseOrder(po.id); refresh(); }}
                        style={{ background: '#3b82f6', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#fff' }}>Submit</button>
                    )}
                    {['submitted', 'partial'].includes(po.status) && (
                      <button onClick={() => setShowReceiveModal(po.id)}
                        style={{ background: 'var(--green)', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#fff' }}>Terima</button>
                    )}
                    {['draft', 'submitted'].includes(po.status) && (
                      <button onClick={async () => { if (confirm('Batalkan PO ini?')) { await cancelPurchaseOrder(po.id); refresh(); } }}
                        style={{ background: 'none', border: '1px solid var(--red)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--red)' }}>Batal</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreateModal && <CreatePOModal onClose={() => setShowCreateModal(false)} onSuccess={() => { setShowCreateModal(false); refresh(); }} />}
      {showReceiveModal && <ReceivePOModal poId={showReceiveModal} onClose={() => setShowReceiveModal(null)} onSuccess={() => { setShowReceiveModal(null); refresh(); }} />}
      {showDetailModal && <PODetailModal poId={showDetailModal} onClose={() => setShowDetailModal(null)} onRefresh={refresh} onEdit={(id) => { setShowDetailModal(null); setShowCreateModal(true); /* TODO: edit mode */ }} />}
    </>
  );
}

// ── Create PO Modal ──

function CreatePOModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [vendors, setVendors] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [entity, setEntity] = useState('BTN-RLB');
  const [poDate, setPODate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [shippingCost, setShippingCost] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [items, setItems] = useState<{ productId: number | null; qty: number; unitPrice: number; search: string }[]>([{ productId: null, qty: 1, unitPrice: 0, search: '' }]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [v, p] = await Promise.all([getVendors(), getProducts()]);
      setVendors(v);
      setProducts(p);
    })();
  }, []);

  const entityProducts = useMemo(() => {
    return products.filter(p => `${p.warehouse}-${p.entity}` === entity || p.entity === entity.replace('BTN-', ''));
  }, [products, entity]);

  const addItem = () => setItems([...items, { productId: null, qty: 1, unitPrice: 0, search: '' }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: any) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = value;
    setItems(newItems);
  };

  const itemsTotal = items.reduce((sum, i) => sum + (i.qty * i.unitPrice), 0);
  const totalValue = itemsTotal + shippingCost + otherCost;

  const handleSubmit = async () => {
    setError('');
    if (!vendorId) { setError('Pilih vendor'); return; }
    const validItems = items.filter(i => i.productId && i.qty > 0);
    if (validItems.length === 0) { setError('Tambahkan minimal 1 produk'); return; }

    setSubmitting(true);
    try {
      await createPurchaseOrder({
        vendorId,
        entity,
        poDate,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        shippingCost: shippingCost || 0,
        otherCost: otherCost || 0,
        items: validItems.map(i => ({
          warehouseProductId: i.productId!,
          quantityRequested: i.qty,
          unitPrice: i.unitPrice,
        })),
      });
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Gagal membuat PO');
    }
    setSubmitting(false);
  };

  const fld = { width: '100%', boxSizing: 'border-box' as const, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' };
  const lbl = { display: 'block' as const, fontSize: 13, color: 'var(--dim)', marginBottom: 6 };
  const itemGrid = { display: 'grid', gridTemplateColumns: '1fr 80px 110px 24px', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--bg-deep)' } as const;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem', overflowY: 'auto' }}>
      <div style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', padding: '28px 32px 24px', width: '100%', maxWidth: 600, boxSizing: 'border-box', margin: 'auto 0' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: 'var(--text)' }}>Buat Purchase Order</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--dim)', padding: 0 }}>&#10005;</button>
        </div>

        {/* Vendor + Entity */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={lbl}>Vendor <span style={{ color: 'var(--red)' }}>*</span></label>
            <select value={vendorId || ''} onChange={e => setVendorId(Number(e.target.value))} style={fld}>
              <option value="">-- Pilih Vendor --</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Entity <span style={{ color: 'var(--red)' }}>*</span></label>
            <select value={entity} onChange={e => setEntity(e.target.value)} style={fld}>
              {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={lbl}>Tanggal PO</label>
            <input type="date" value={poDate} onChange={e => setPODate(e.target.value)} style={fld} />
          </div>
          <div>
            <label style={lbl}>Exp. Delivery</label>
            <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} style={fld} />
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Catatan</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Tambahkan catatan..."
            style={{ ...fld, height: 64, resize: 'none' as const }} />
        </div>

        {/* Divider + Items */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Item PO</span>
            <button onClick={addItem}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>+ Tambah</button>
          </div>

          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 24px', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Produk</span>
            <span style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Qty</span>
            <span style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }}>Harga/unit</span>
            <span />
          </div>

          {/* Item rows */}
          {items.map((item, idx) => (
            <div key={idx} style={{ ...itemGrid, borderBottom: idx < items.length - 1 ? '1px solid var(--bg-deep)' : 'none' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Cari produk..."
                  value={item.productId ? (entityProducts.find(p => p.id === item.productId)?.name || item.search) : item.search}
                  onChange={e => { updateItem(idx, 'search', e.target.value); updateItem(idx, 'productId', null); }}
                  onBlur={() => setTimeout(() => { if (!items[idx]?.productId) updateItem(idx, 'search', items[idx]?.search || ''); }, 150)}
                  style={{ ...fld, fontSize: 13 }} />
                {!item.productId && item.search.length > 0 && (
                  <div style={{ position: 'fixed', zIndex: 9999, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', width: 'var(--dropdown-w, 300px)' }}
                    ref={el => {
                      if (el) {
                        const input = el.parentElement?.querySelector('input');
                        if (input) {
                          const rect = input.getBoundingClientRect();
                          el.style.left = rect.left + 'px';
                          el.style.top = (rect.bottom + 4) + 'px';
                          el.style.width = rect.width + 'px';
                        }
                      }
                    }}>
                    {entityProducts
                      .filter(p => !item.search || p.name.toLowerCase().includes(item.search.toLowerCase()))
                      .slice(0, 20)
                      .map(p => (
                        <div key={p.id}
                          onMouseDown={e => { e.preventDefault(); updateItem(idx, 'productId', p.id); updateItem(idx, 'search', p.name); if (p.hpp > 0) updateItem(idx, 'unitPrice', Number(p.hpp)); }}
                          style={{ padding: '9px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--text)', borderBottom: '1px solid var(--bg-deep)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          {p.name} <span style={{ color: 'var(--dim)', fontSize: 11 }}>({p.category})</span>
                        </div>
                      ))}
                    {entityProducts.filter(p => !item.search || p.name.toLowerCase().includes(item.search.toLowerCase())).length === 0 && (
                      <div style={{ padding: '9px 12px', fontSize: 12, color: 'var(--dim)' }}>Tidak ditemukan</div>
                    )}
                  </div>
                )}
              </div>
              <input type="number" value={item.qty || ''} onChange={e => updateItem(idx, 'qty', Number(e.target.value))} min={1}
                style={{ ...fld, textAlign: 'right' }} />
              <input type="number" placeholder="0" value={item.unitPrice || ''} onChange={e => updateItem(idx, 'unitPrice', Number(e.target.value))} min={0}
                style={{ ...fld, textAlign: 'right' }} />
              <button onClick={() => removeItem(idx)}
                style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 13, padding: 0 }}>&#10005;</button>
            </div>
          ))}

        </div>

        {/* Summary: Subtotal + Ongkir + Biaya Lain + Total */}
        <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
            <span style={{ fontSize: 13, color: 'var(--dim)' }}>Subtotal</span>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>Rp {fmtNum(itemsTotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
            <span style={{ fontSize: 13, color: 'var(--dim)' }}>Ongkir</span>
            <input type="number" value={shippingCost || ''} onChange={e => setShippingCost(Number(e.target.value) || 0)} placeholder="0"
              style={{ ...fld, width: 130, textAlign: 'right' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
            <span style={{ fontSize: 13, color: 'var(--dim)' }}>Biaya Lain</span>
            <input type="number" value={otherCost || ''} onChange={e => setOtherCost(Number(e.target.value) || 0)} placeholder="0"
              style={{ ...fld, width: 130, textAlign: 'right' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Total</span>
            <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)' }}>Rp {fmtNum(totalValue)}</span>
          </div>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, marginTop: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 14, marginTop: 4, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}>Batal</button>
          <button onClick={handleSubmit} disabled={submitting}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Menyimpan...' : 'Simpan Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Receive PO Modal ──

function ReceivePOModal({ poId, onClose, onSuccess }: { poId: number; onClose: () => void; onSuccess: () => void }) {
  const [po, setPO] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<{ poItemId: number; productName: string; unitPrice: number; qtyRequested: number; remaining: number; qtyReceived: number; batchCode: string; expiredDate: string; checked: boolean }[]>([]);
  const [shippingCost, setShippingCost] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getPurchaseOrderDetail(poId);
        setPO(data);
        setShippingCost(Number(data.shipping_cost || 0));
        setOtherCost(Number(data.other_cost || 0));
        setItems((data.warehouse_po_items || []).map((item: any) => {
          const remaining = Number(item.quantity_requested) - Number(item.quantity_received);
          return {
            poItemId: item.id,
            productName: item.warehouse_products?.name || '-',
            unitPrice: Number(item.unit_price || 0),
            qtyRequested: Number(item.quantity_requested),
            remaining,
            qtyReceived: remaining,
            batchCode: '',
            expiredDate: '',
            checked: remaining > 0,
          };
        }));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [poId]);

  // Calculate HPP preview per item (proportional by value)
  const totalPoValue = items.reduce((s, i) => s + i.unitPrice * i.qtyRequested, 0);
  const extraCost = shippingCost + otherCost;
  const getHppPreview = (item: typeof items[0]) => {
    if (item.unitPrice <= 0 || item.qtyReceived <= 0) return 0;
    let cpp = item.unitPrice;
    if (extraCost > 0 && totalPoValue > 0) {
      const itemValue = item.unitPrice * item.qtyRequested;
      const share = itemValue / totalPoValue;
      cpp += (extraCost * share) / item.qtyReceived;
    }
    return Math.round(cpp);
  };

  const handleSubmit = async () => {
    setError('');
    const toReceive = items.filter(i => i.checked && i.qtyReceived > 0);
    if (toReceive.length === 0) { setError('Pilih minimal 1 item untuk diterima'); return; }

    for (const item of toReceive) {
      if (!item.batchCode.trim()) { setError(`Batch code wajib untuk ${item.productName}`); return; }
      if (item.qtyReceived > item.remaining) { setError(`Qty melebihi sisa untuk ${item.productName}`); return; }
    }

    setSubmitting(true);
    try {
      // Save PO-level costs before receiving (server action)
      await savePOCosts(poId, shippingCost, otherCost);

      await receivePOItems(poId, toReceive.map(i => ({
        poItemId: i.poItemId,
        quantityReceived: i.qtyReceived,
        batchCode: i.batchCode,
        expiredDate: i.expiredDate || null,
      })));
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Gagal menerima PO');
    }
    setSubmitting(false);
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = value;
    setItems(newItems);
  };

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--card)', borderRadius: 16, padding: 40, color: 'var(--dim)' }}>Memuat...</div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--card)', borderRadius: 16, padding: 24, width: '95%', maxWidth: 720, maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Terima Barang — {po?.po_number}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--dim)' }}>&times;</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>
          Vendor: <strong>{po?.warehouse_vendors?.name}</strong> | Entity: <strong>{po?.entity}</strong>
        </div>

        {/* Landed cost inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16, background: 'var(--bg)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 600 }}>Ongkir (seluruh PO)</label>
            <input type="number" value={shippingCost || ''} onChange={e => setShippingCost(Number(e.target.value) || 0)} placeholder="0"
              style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 12, textAlign: 'right' }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 600 }}>Biaya Lain (seluruh PO)</label>
            <input type="number" value={otherCost || ''} onChange={e => setOtherCost(Number(e.target.value) || 0)} placeholder="0"
              style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 12, textAlign: 'right' }} />
          </div>
        </div>

        {/* Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {items.map((item, idx) => (
            <div key={item.poItemId} style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, border: item.checked ? '1px solid var(--accent)' : '1px solid var(--border)', opacity: item.remaining <= 0 ? 0.4 : 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input type="checkbox" checked={item.checked} onChange={e => updateItem(idx, 'checked', e.target.checked)} disabled={item.remaining <= 0} />
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{item.productName}</span>
                <span style={{ fontSize: 11, color: 'var(--dim)', marginLeft: 'auto' }}>Sisa: {fmtNum(item.remaining)}</span>
              </div>
              {item.checked && item.remaining > 0 && (<>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--dim)' }}>Qty Diterima *</label>
                    <input type="number" value={item.qtyReceived || ''} onChange={e => updateItem(idx, 'qtyReceived', Number(e.target.value))}
                      max={item.remaining} min={1}
                      style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 12, textAlign: 'right' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--dim)' }}>Batch Code *</label>
                    <input value={item.batchCode} onChange={e => updateItem(idx, 'batchCode', e.target.value)} placeholder="B-240401"
                      style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 12 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--dim)' }}>Expired Date</label>
                    <input type="date" value={item.expiredDate} onChange={e => updateItem(idx, 'expiredDate', e.target.value)}
                      style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 12 }} />
                  </div>
                </div>
                {item.unitPrice > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--dim)' }}>
                    Harga: Rp {fmtNum(item.unitPrice)}/unit
                    {extraCost > 0 && <> + biaya Rp {fmtNum(Math.round((extraCost * (item.unitPrice * item.qtyRequested / totalPoValue)) / item.qtyReceived))}/unit</>}
                    {' → '}<strong style={{ color: 'var(--green)' }}>HPP: Rp {fmtNum(getHppPreview(item))}/unit</strong>
                  </div>
                )}
              </>)}
            </div>
          ))}
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>Batal</button>
          <button onClick={handleSubmit} disabled={submitting}
            style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Menyimpan...' : 'Terima Barang'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PO Detail Modal ──

function PODetailModal({ poId, onClose, onRefresh, onEdit }: { poId: number; onClose: () => void; onRefresh: () => void; onEdit?: (id: number) => void }) {
  const [po, setPO] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getPurchaseOrderDetail(poId);
        setPO(data);
      } catch (e: any) {
        console.error(e);
        setError(typeof e === 'string' ? e : e?.message || JSON.stringify(e) || 'Gagal memuat detail PO');
      }
      setLoading(false);
    })();
  }, [poId]);

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--card)', borderRadius: 16, padding: 40, color: 'var(--dim)' }}>Memuat...</div>
    </div>
  );

  if (error || !po) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--card)', borderRadius: 16, padding: 32, maxWidth: 400, textAlign: 'center' }}>
        <div style={{ color: 'var(--red)', fontSize: 14, marginBottom: 16 }}>{error || 'Data PO tidak ditemukan'}</div>
        <button onClick={onClose} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>Tutup</button>
      </div>
    </div>
  );

  const totalValue = (po?.warehouse_po_items || []).reduce((sum: number, i: any) => sum + (Number(i.quantity_requested) * Number(i.unit_price)), 0);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--card)', borderRadius: 16, padding: 24, width: '95%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Detail PO — {po?.po_number}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--dim)' }}>&times;</button>
        </div>

        {/* Header info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16, fontSize: 13 }}>
          <div><span style={{ color: 'var(--dim)' }}>Vendor:</span> <strong>{po?.warehouse_vendors?.name}</strong></div>
          <div><span style={{ color: 'var(--dim)' }}>Entity:</span> <strong>{po?.entity}</strong></div>
          <div><span style={{ color: 'var(--dim)' }}>Tanggal PO:</span> {fmtDate(po?.po_date)}</div>
          <div><span style={{ color: 'var(--dim)' }}>Exp. Delivery:</span> {fmtDate(po?.expected_date)}</div>
          <div><span style={{ color: 'var(--dim)' }}>Status:</span> <StatusBadge status={po?.status} /></div>
          <div><span style={{ color: 'var(--dim)' }}>Dibuat oleh:</span> {po?.profiles?.full_name || po?.profiles?.email || '-'}</div>
        </div>

        {po?.notes && <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8 }}>{po.notes}</div>}

        {/* Items table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Produk', 'Kategori', 'Qty Request', 'Qty Received', 'Harga Satuan', 'Subtotal'].map(h => (
                <th key={h} style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(po?.warehouse_po_items || []).map((item: any) => {
              const pct = Number(item.quantity_requested) > 0 ? Math.round(Number(item.quantity_received) / Number(item.quantity_requested) * 100) : 0;
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontWeight: 600 }}>{item.warehouse_products?.name || '-'}</td>
                  <td style={{ padding: '8px' }}>{item.warehouse_products?.category || '-'}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(Number(item.quantity_requested))}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                    {fmtNum(Number(item.quantity_received))}
                    <span style={{ fontSize: 10, color: pct >= 100 ? 'var(--green)' : '#f59e0b', marginLeft: 4 }}>({pct}%)</span>
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>Rp {fmtNum(Number(item.unit_price))}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>Rp {fmtNum(Number(item.quantity_requested) * Number(item.unit_price))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={5} style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontSize: 13 }}>Total:</td>
              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>Rp {fmtNum(totalValue)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {po?.status === 'draft' && (
              <>
                <button onClick={async () => {
                    setActionLoading('submit');
                    try { await submitPurchaseOrder(poId); onRefresh(); onClose(); } catch (e: any) { setError(e?.message || 'Gagal submit'); }
                    setActionLoading('');
                  }} disabled={!!actionLoading}
                  style={{ background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: actionLoading === 'submit' ? 0.6 : 1 }}>
                  {actionLoading === 'submit' ? 'Submitting...' : 'Submit PO'}
                </button>
                <button onClick={() => { if (onEdit) onEdit(poId); }}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: 'var(--text)', fontWeight: 600 }}>
                  Edit
                </button>
              </>
            )}
            {['draft', 'submitted'].includes(po?.status) && (
              confirmCancel ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--dim)' }}>Yakin batalkan?</span>
                  <button onClick={async () => {
                      setActionLoading('cancel');
                      try { await cancelPurchaseOrder(poId); onRefresh(); onClose(); } catch (e: any) { setError(e?.message || 'Gagal cancel'); }
                      setActionLoading('');
                    }} disabled={!!actionLoading}
                    style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Ya, Batalkan
                  </button>
                  <button onClick={() => setConfirmCancel(false)}
                    style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--dim)' }}>
                    Tidak
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmCancel(true)}
                  style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: 'var(--red)', fontWeight: 600 }}>
                  Batalkan PO
                </button>
              )
            )}
          </div>
          <button onClick={onClose} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 20px', fontSize: 13, cursor: 'pointer', color: 'var(--text)' }}>Tutup</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DEMAND TAB — Weekly (default) + Monthly view with pace
// ============================================================

function DemandTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [viewMode, setViewMode] = useState<'weekly' | 'monthly'>('weekly');
  const [plans, setPlans] = useState<any[]>([]);
  const [weeklyData, setWeeklyData] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [entityFilter, setEntityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [hideZeroDemand, setHideZeroDemand] = useState(true);

  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
  const dayOfMonth = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
  const currentWeek = dayOfMonth <= 7 ? 1 : dayOfMonth <= 14 ? 2 : dayOfMonth <= 21 ? 3 : 4;
  const weekDays = [7, 7, 7, daysInMonth - 21]; // days per week

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, w] = await Promise.all([
        getDemandPlans(month, year),
        getWeeklyDemandData(month, year),
      ]);
      setPlans(p);
      setWeeklyData(w);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [month, year]);

  const handleInit = async () => {
    setInitializing(true);
    try {
      await initDemandPlans(month, year);
      await loadData();
    } catch (e) { console.error(e); }
    setInitializing(false);
  };

  const handleSaveManual = async (productId: number) => {
    try {
      const val = editValue === '' ? null : Number(editValue);
      await updateDemandPlan(productId, month, year, val);
      setEditingId(null);
      loadData();
    } catch (e) { console.error(e); }
  };

  const filtered = useMemo(() => {
    let result = plans;
    if (entityFilter !== 'all') result = result.filter(p => p.warehouse_products?.entity === entityFilter.replace('BTN-', ''));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.warehouse_products?.name?.toLowerCase().includes(q));
    }
    if (hideZeroDemand) {
      result = result.filter(p => {
        const effective = p.manual_demand !== null ? Number(p.manual_demand) : Number(p.auto_demand);
        return effective > 0;
      });
    }
    return result;
  }, [plans, entityFilter, searchQuery, hideZeroDemand]);

  const getEffective = (plan: any) => plan.manual_demand !== null ? Number(plan.manual_demand) : Number(plan.auto_demand);

  const getWeeklyTarget = (effective: number, weekNum: number) => {
    // Proportional: target per week based on days in that week
    return Math.round(effective * weekDays[weekNum - 1] / daysInMonth);
  };

  const getStatusColor = (actual: number, target: number, threshold = 0.15) => {
    if (target <= 0) return 'var(--dim)';
    const ratio = actual / target;
    if (ratio >= (1 - threshold)) return 'var(--green)';
    if (ratio >= (1 - threshold * 2)) return '#f59e0b';
    return 'var(--red)';
  };

  const selectStyle = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' };
  const toggleBtnStyle = (active: boolean) => ({
    padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 6,
    background: active ? 'var(--accent)' : 'var(--bg)',
    color: active ? '#fff' : 'var(--dim)',
  });

  return (
    <>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 8, padding: 2, border: '1px solid var(--border)' }}>
          <button onClick={() => setViewMode('weekly')} style={toggleBtnStyle(viewMode === 'weekly')}>Mingguan</button>
          <button onClick={() => setViewMode('monthly')} style={toggleBtnStyle(viewMode === 'monthly')}>Bulanan</button>
        </div>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} style={selectStyle}>
          {ID_MONTHS.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))} style={selectStyle}>
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <input placeholder="Cari produk..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ ...selectStyle, minWidth: 180 }} />
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} style={selectStyle}>
          <option value="all">Semua Entity</option>
          {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--dim)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={hideZeroDemand} onChange={e => setHideZeroDemand(e.target.checked)} /> Sembunyikan demand = 0
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={handleInit} disabled={initializing}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: initializing ? 0.6 : 1 }}>
          {initializing ? 'Menghitung...' : 'Inisialisasi dari Scalev'}
        </button>
      </div>

      {loading ? <div style={{ color: 'var(--dim)', padding: 40, textAlign: 'center' }}>Memuat...</div> : plans.length === 0 ? (
        <div style={{ color: 'var(--dim)', padding: 40, textAlign: 'center', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          Belum ada data demand planning untuk {ID_MONTHS[month]} {year}. Klik "Inisialisasi dari Scalev" untuk menghitung otomatis.
        </div>
      ) : viewMode === 'weekly' ? (
        /* ── WEEKLY VIEW ── */
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--dim)', fontSize: 10, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>PRODUK</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--dim)', fontSize: 10 }}>ENTITY</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--dim)', fontSize: 10 }}>TARGET/BLN</th>
                {[1, 2, 3, 4].map(w => (
                  <th key={w} colSpan={2} style={{
                    padding: '8px 10px', textAlign: 'center', fontWeight: 600, fontSize: 10,
                    color: isCurrentMonth && w === currentWeek ? 'var(--accent)' : 'var(--dim)',
                    borderLeft: '1px solid var(--border)',
                  }}>
                    W{w} ({w < 4 ? `${(w - 1) * 7 + 1}-${w * 7}` : `22-${daysInMonth}`})
                    {isCurrentMonth && w === currentWeek && ' *'}
                  </th>
                ))}
              </tr>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }} />
                <th />
                <th />
                {[1, 2, 3, 4].map(w => (
                  <>
                    <th key={`${w}t`} style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, color: 'var(--dim)', fontSize: 9, borderLeft: '1px solid var(--border)' }}>TARGET</th>
                    <th key={`${w}a`} style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600, color: 'var(--dim)', fontSize: 9 }}>ACTUAL</th>
                  </>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(plan => {
                const effective = getEffective(plan);
                const pid = plan.warehouse_product_id;
                const wd = weeklyData[pid] || {};

                return (
                  <tr key={plan.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>{plan.warehouse_products?.name}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11 }}>{plan.warehouse_products?.entity}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmtNum(effective)}</td>
                    {[1, 2, 3, 4].map(w => {
                      const target = getWeeklyTarget(effective, w);
                      const actual = Number(wd[`w${w}_out`] || 0);
                      const weekPassed = isCurrentMonth ? w < currentWeek : true;
                      const weekCurrent = isCurrentMonth && w === currentWeek;
                      // For current week, prorate target
                      const daysInWeek = weekDays[w - 1];
                      const daysElapsedInWeek = weekCurrent ? Math.max(1, dayOfMonth - (w === 1 ? 0 : w === 2 ? 7 : w === 3 ? 14 : 21)) : daysInWeek;
                      const proratedTarget = weekCurrent ? Math.round(target * daysElapsedInWeek / daysInWeek) : target;
                      const isFuture = isCurrentMonth && w > currentWeek;
                      const color = isFuture ? 'var(--dim)' : getStatusColor(actual, proratedTarget);

                      return (
                        <>
                          <td key={`${w}t`} style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--dim)', fontSize: 11, borderLeft: '1px solid var(--border)' }}>
                            {fmtNum(target)}
                          </td>
                          <td key={`${w}a`} style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color }}>
                            {isFuture ? '-' : fmtNum(actual)}
                          </td>
                        </>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '8px 12px', fontSize: 10, color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
            * Minggu berjalan. Target di-prorate sesuai hari yang sudah lewat. Hijau = on pace (&ge;85%), Kuning = behind (70-85%), Merah = far behind (&lt;70%).
          </div>
        </div>
      ) : (
        /* ── MONTHLY VIEW with Pace ── */
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['No', 'Produk', 'Entity', 'Kategori', 'Demand', 'Override', 'Effective', 'Actual In', 'Actual Out', 'Prorated Target', 'Variance', 'Projected', 'Pace'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: ['No'].includes(h) ? 'center' : 'left', fontWeight: 600, color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((plan, idx) => {
                const effective = getEffective(plan);
                const actualOut = Number(plan.actual_out);
                // Prorated: what we expect to have sold by now
                const proratedTarget = Math.round(effective * dayOfMonth / daysInMonth);
                const variance = proratedTarget - actualOut;
                const variancePct = proratedTarget > 0 ? Math.round(Math.abs(variance) / proratedTarget * 100) : 0;
                const varianceColor = variancePct <= 15 ? 'var(--green)' : variancePct <= 30 ? '#f59e0b' : 'var(--red)';
                // Projected month-end
                const projected = dayOfMonth > 0 ? Math.round(actualOut / dayOfMonth * daysInMonth) : 0;
                const projectedPct = effective > 0 ? Math.round(projected / effective * 100) : 0;
                const paceColor = projectedPct >= 85 ? 'var(--green)' : projectedPct >= 70 ? '#f59e0b' : 'var(--red)';
                const paceLabel = projectedPct >= 85 ? 'On Track' : projectedPct >= 70 ? 'Behind' : 'Far Behind';

                return (
                  <tr key={plan.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--dim)' }}>{idx + 1}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{plan.warehouse_products?.name}</td>
                    <td style={{ padding: '8px 10px' }}>{plan.warehouse_products?.entity}</td>
                    <td style={{ padding: '8px 10px' }}>{plan.warehouse_products?.category}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(Number(plan.auto_demand))}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', cursor: 'pointer' }}
                      onClick={() => { setEditingId(plan.warehouse_product_id); setEditValue(plan.manual_demand !== null ? String(plan.manual_demand) : ''); }}>
                      {editingId === plan.warehouse_product_id ? (
                        <input type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                          onBlur={() => handleSaveManual(plan.warehouse_product_id)}
                          onKeyDown={e => e.key === 'Enter' && handleSaveManual(plan.warehouse_product_id)}
                          autoFocus
                          style={{ width: 80, background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text)', fontSize: 12, textAlign: 'right' }} />
                      ) : (
                        <span style={{ color: plan.manual_demand !== null ? 'var(--accent)' : 'var(--dim)' }}>
                          {plan.manual_demand !== null ? fmtNum(Number(plan.manual_demand)) : '-'}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmtNum(effective)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--green)' }}>{fmtNum(Number(plan.actual_in))}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(actualOut)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--dim)' }}>{fmtNum(proratedTarget)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: varianceColor, fontWeight: 600 }}>
                      {variance > 0 ? '+' : ''}{fmtNum(variance)}
                      <span style={{ fontSize: 10, marginLeft: 4 }}>({variancePct}%)</span>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(projected)}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: paceColor, color: '#fff' }}>
                        {paceLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: '8px 12px', fontSize: 10, color: 'var(--dim)', borderTop: '1px solid var(--border)' }}>
            Prorated Target = Effective &times; ({dayOfMonth}/{daysInMonth} hari). Projected = Actual Out &times; ({daysInMonth}/{dayOfMonth}). Pace: On Track &ge;85%, Behind 70-85%, Far Behind &lt;70%.
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// ITO TAB
// ============================================================

function ITOTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);
  const [entityFilter, setEntityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [source, setSource] = useState<'warehouse' | 'scalev'>('scalev');
  const [stockFilter, setStockFilter] = useState<'aktif' | 'semua' | 'ada_stok' | 'dead_stock'>('aktif');
  const [sortCol, setSortCol] = useState('product_name');
  const [sortAsc, setSortAsc] = useState(true);
  const handleSort = (col: string) => { if (sortCol === col) setSortAsc(!sortAsc); else { setSortCol(col); setSortAsc(true); } };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setData(await getITOData(months, source)); } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [months, source]);

  // Collect all unique month columns
  const monthColumns = useMemo(() => {
    const cols = new Set<string>();
    for (const prod of data) {
      for (const m of prod.months) {
        cols.add(`${m.year}-${String(m.month).padStart(2, '0')}`);
      }
    }
    return [...cols].sort().reverse();
  }, [data]);

  const filtered = useMemo(() => {
    let result = data;
    if (entityFilter !== 'all') result = result.filter(p => p.entity === entityFilter.replace('BTN-', ''));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.product_name?.toLowerCase().includes(q));
    }
    if (stockFilter === 'aktif') {
      result = result.filter(p => p.months.some((m: any) => m.total_out > 0));
    } else if (stockFilter === 'ada_stok') {
      result = result.filter(p => p.current_stock > 0);
    } else if (stockFilter === 'dead_stock') {
      result = result.filter(p => p.current_stock > 0 && !p.months.some((m: any) => m.total_out > 0));
    }
    const dir = sortAsc ? 1 : -1;
    result = [...result].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (Number(av) - Number(bv)) * dir;
    });
    return result;
  }, [data, entityFilter, searchQuery, stockFilter, sortCol, sortAsc]);

  const getITOColor = (ito: number) => {
    if (ito >= 6) return 'var(--green)';
    if (ito >= 3) return '#f59e0b';
    return 'var(--red)';
  };

  const getDOSColor = (dos: number) => {
    if (dos === 0) return 'var(--dim)';
    if (dos >= 999) return 'var(--dim)';
    if (dos > 7) return 'var(--green)';
    if (dos >= 3) return '#f59e0b';
    return 'var(--red)';
  };

  const totals = useMemo(() => {
    const totalHPP = filtered.reduce((s: number, p: any) => s + (p.stock_value_hpp || 0), 0);
    const totalPrice = filtered.reduce((s: number, p: any) => s + (p.stock_value_price || 0), 0);
    const totalSKU = filtered.length;
    return { totalHPP, totalPrice, totalSKU };
  }, [filtered]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={months} onChange={e => setMonths(Number(e.target.value))}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13 }}>
          <option value={3}>3 Bulan</option>
          <option value={6}>6 Bulan</option>
          <option value={12}>12 Bulan</option>
        </select>
        <input placeholder="Cari produk..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, minWidth: 180 }} />
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13 }}>
          <option value="all">Semua Entity</option>
          {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value as any)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13 }}>
          <option value="aktif">Aktif (ada movement)</option>
          <option value="ada_stok">Ada stok</option>
          <option value="dead_stock">Dead stock</option>
          <option value="semua">Semua produk</option>
        </select>
      </div>

      {/* Source toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button onClick={() => setSource('warehouse')}
          style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${source === 'warehouse' ? 'var(--accent)' : 'var(--border)'}`, background: source === 'warehouse' ? 'var(--accent)' : 'transparent', color: source === 'warehouse' ? '#fff' : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
          Warehouse PoV
        </button>
        <button onClick={() => setSource('scalev')}
          style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${source === 'scalev' ? 'var(--accent)' : 'var(--border)'}`, background: source === 'scalev' ? 'var(--accent)' : 'transparent', color: source === 'scalev' ? '#fff' : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
          Scalev PoV
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 12 }}>
        ITO = (Monthly Out &times; 12) / Current Stock. Hijau &ge;6, Kuning 3-6, Merah &lt;3.
        <br />Hari Stok = Stock / Avg Out per Hari. Hijau &gt;7, Kuning 3-7, Merah &lt;3.
      </div>

      {!loading && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 2 }}>SKU</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{fmtNum(totals.totalSKU)}</div>
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 2 }}>Nilai Stok (HPP)</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>Rp {fmtNum(Math.round(totals.totalHPP))}</div>
          </div>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 2 }}>Nilai Stok (Harga Jual)</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>Rp {fmtNum(Math.round(totals.totalPrice))}</div>
          </div>
        </div>
      )}

      {loading ? <div style={{ color: 'var(--dim)', padding: 40, textAlign: 'center' }}>Memuat...</div> : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th onClick={() => handleSort('product_name')} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--dim)', fontSize: 10, position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, cursor: 'pointer' }}>PRODUK {sortCol === 'product_name' ? (sortAsc ? '▲' : '▼') : ''}</th>
                <th onClick={() => handleSort('entity')} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--dim)', fontSize: 10, cursor: 'pointer' }}>ENTITY {sortCol === 'entity' ? (sortAsc ? '▲' : '▼') : ''}</th>
                <th onClick={() => handleSort('current_stock')} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--dim)', fontSize: 10, cursor: 'pointer' }}>STOCK {sortCol === 'current_stock' ? (sortAsc ? '▲' : '▼') : ''}</th>
                <th onClick={() => handleSort('avg_out_per_day')} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--dim)', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>AVG OUT/HARI {sortCol === 'avg_out_per_day' ? (sortAsc ? '▲' : '▼') : ''}</th>
                <th onClick={() => handleSort('days_of_stock')} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--dim)', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>HARI STOK {sortCol === 'days_of_stock' ? (sortAsc ? '▲' : '▼') : ''}</th>
                {monthColumns.map(mc => {
                  const [y, m] = mc.split('-');
                  return <th key={mc} style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: 'var(--dim)', fontSize: 10, whiteSpace: 'nowrap' }}>{ID_MONTHS[Number(m)].slice(0, 3)} {y.slice(2)}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map(prod => (
                <tr key={prod.product_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>{prod.product_name}</td>
                  <td style={{ padding: '6px 10px' }}>{prod.entity}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(prod.current_stock)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{prod.avg_out_per_day > 0 ? prod.avg_out_per_day.toFixed(1) : '-'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: getDOSColor(prod.days_of_stock) }}>{prod.days_of_stock >= 999 ? '∞' : prod.days_of_stock > 0 ? prod.days_of_stock : '-'}</td>
                  {monthColumns.map(mc => {
                    const [y, m] = mc.split('-');
                    const monthData = prod.months.find((md: any) => md.year === Number(y) && md.month === Number(m));
                    const ito = monthData?.ito || 0;
                    return (
                      <td key={mc} style={{ padding: '6px 10px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600, color: ito > 0 ? getITOColor(ito) : 'var(--dim)' }}>
                        {ito > 0 ? ito.toFixed(1) : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ============================================================
// ROP TAB
// ============================================================

function ROPTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [demandDays, setDemandDays] = useState(90);
  const [entityFilter, setEntityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editField, setEditField] = useState<string>('');
  const [editValue, setEditValue] = useState('');
  const [hideZeroDemand, setHideZeroDemand] = useState(true);
  const [ropSortCol, setRopSortCol] = useState('product_name');
  const [ropSortAsc, setRopSortAsc] = useState(true);
  const handleRopSort = (col: string) => { if (ropSortCol === col) setRopSortAsc(!ropSortAsc); else { setRopSortCol(col); setRopSortAsc(true); } };

  const loadData = async () => {
    setLoading(true);
    try { setData(await getROPAnalysis(demandDays)); } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [demandDays]);

  const filtered = useMemo(() => {
    let result = data;
    if (entityFilter !== 'all') result = result.filter(p => p.entity === entityFilter.replace('BTN-', ''));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => p.product_name?.toLowerCase().includes(q));
    }
    if (hideZeroDemand) result = result.filter(p => Number(p.avg_daily) > 0);
    const dir = ropSortAsc ? 1 : -1;
    result = [...result].sort((a, b) => {
      let av = a[ropSortCol], bv = b[ropSortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (Number(av) - Number(bv)) * dir;
    });
    return result;
  }, [data, entityFilter, searchQuery, hideZeroDemand, ropSortCol, ropSortAsc]);

  const kpi = useMemo(() => {
    const critical = data.filter(d => d.status === 'critical').length;
    const reorder = data.filter(d => d.status === 'reorder').length;
    const ok = data.filter(d => d.status === 'ok').length;
    return { critical, reorder, ok };
  }, [data]);

  const handleSaveConfig = async (productId: number, field: string) => {
    try {
      const val = Number(editValue);
      if (isNaN(val) || val < 0) return;
      const existing = data.find(d => d.product_id === productId);
      if (!existing) return;
      await updateProductROPConfig(
        productId,
        field === 'lead_time_days' ? val : existing.lead_time_days,
        field === 'safety_stock_days' ? val : existing.safety_stock_days,
      );
      setEditingId(null);
      setEditField('');
      loadData();
    } catch (e) { console.error(e); }
  };

  const statusColors = { critical: 'var(--red)', reorder: '#f59e0b', ok: 'var(--green)' };
  const statusLabels = { critical: 'CRITICAL', reorder: 'REORDER', ok: 'OK' };

  return (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Critical" value={String(kpi.critical)} color="var(--red)" sub="Stock < Safety Stock" />
        <KPICard label="Perlu Reorder" value={String(kpi.reorder)} color="#f59e0b" sub="Stock < ROP" />
        <KPICard label="OK" value={String(kpi.ok)} color="var(--green)" sub="Stock cukup" />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={demandDays} onChange={e => setDemandDays(Number(e.target.value))}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13 }}>
          <option value={30}>30 Hari</option>
          <option value={60}>60 Hari</option>
          <option value={90}>90 Hari</option>
        </select>
        <input placeholder="Cari produk..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, minWidth: 180 }} />
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13 }}>
          <option value="all">Semua Entity</option>
          {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--dim)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={hideZeroDemand} onChange={e => setHideZeroDemand(e.target.checked)} /> Sembunyikan demand = 0
        </label>
      </div>

      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 12 }}>
        ROP = (Avg Daily &times; Lead Time) + Safety Stock. Klik Lead Time / Safety Days untuk edit.
      </div>

      {loading ? <div style={{ color: 'var(--dim)', padding: 40, textAlign: 'center' }}>Memuat...</div> : (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {[
                  { label: 'Produk', key: 'product_name', align: 'left' },
                  { label: 'Entity', key: 'entity', align: 'left' },
                  { label: 'Stock', key: 'current_stock', align: 'right' },
                  { label: 'Avg/Day', key: 'avg_daily', align: 'right' },
                  { label: 'Lead Time', key: 'lead_time', align: 'right' },
                  { label: 'Safety Days', key: 'safety_days', align: 'right' },
                  { label: 'Safety Qty', key: 'safety_stock', align: 'right' },
                  { label: 'ROP', key: 'rop', align: 'right' },
                  { label: 'Days Left', key: 'days_of_stock', align: 'right' },
                  { label: 'Status', key: 'status', align: 'left' },
                ].map(h => (
                  <th key={h.key} onClick={() => handleRopSort(h.key)}
                    style={{ padding: '8px 10px', textAlign: h.align as any, fontWeight: 600, color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                    {h.label} {ropSortCol === h.key ? (ropSortAsc ? '▲' : '▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.product_id} style={{ borderBottom: '1px solid var(--border)', background: row.status === 'critical' ? 'rgba(239,68,68,0.05)' : row.status === 'reorder' ? 'rgba(245,158,11,0.05)' : 'transparent' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.product_name}</td>
                  <td style={{ padding: '8px 10px' }}>{row.entity}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(row.current_stock)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{row.avg_daily.toFixed(1)}</td>

                  {/* Lead Time (editable) */}
                  <td style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer' }}
                    onClick={() => { setEditingId(row.product_id); setEditField('lead_time_days'); setEditValue(String(row.lead_time_days)); }}>
                    {editingId === row.product_id && editField === 'lead_time_days' ? (
                      <input type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                        onBlur={() => handleSaveConfig(row.product_id, 'lead_time_days')}
                        onKeyDown={e => e.key === 'Enter' && handleSaveConfig(row.product_id, 'lead_time_days')}
                        autoFocus min={1}
                        style={{ width: 50, background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 4px', color: 'var(--text)', fontSize: 12, textAlign: 'right' }} />
                    ) : (
                      <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{row.lead_time_days}d</span>
                    )}
                  </td>

                  {/* Safety Days (editable) */}
                  <td style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer' }}
                    onClick={() => { setEditingId(row.product_id); setEditField('safety_stock_days'); setEditValue(String(row.safety_stock_days)); }}>
                    {editingId === row.product_id && editField === 'safety_stock_days' ? (
                      <input type="number" value={editValue} onChange={e => setEditValue(e.target.value)}
                        onBlur={() => handleSaveConfig(row.product_id, 'safety_stock_days')}
                        onKeyDown={e => e.key === 'Enter' && handleSaveConfig(row.product_id, 'safety_stock_days')}
                        autoFocus min={0}
                        style={{ width: 50, background: 'var(--bg)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 4px', color: 'var(--text)', fontSize: 12, textAlign: 'right' }} />
                    ) : (
                      <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{row.safety_stock_days}d</span>
                    )}
                  </td>

                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(row.safety_stock_qty)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmtNum(row.rop)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: row.days_of_stock > 30 ? 'var(--green)' : row.days_of_stock > 14 ? '#f59e0b' : 'var(--red)' }}>
                    {row.days_of_stock >= 999 ? '∞' : `${row.days_of_stock}d`}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: statusColors[row.status as keyof typeof statusColors], color: '#fff' }}>
                      {statusLabels[row.status as keyof typeof statusLabels]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
