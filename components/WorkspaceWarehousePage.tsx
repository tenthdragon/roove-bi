'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  adjustWorkspaceWarehouseStock,
  createWorkspaceWarehouseProduct,
  getWorkspaceWarehouseInventory,
  getWorkspaceWarehouseMappings,
  getWorkspaceWarehouseMovements,
  getWorkspaceWarehouseState,
  syncWorkspaceWarehouseMappingNames,
  updateWorkspaceWarehouseMapping,
} from '@/lib/workspace-warehouse-actions';
import { useWorkspace } from '@/lib/WorkspaceContext';

const money = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

export default function WorkspaceWarehousePage() {
  const { activeWorkspace } = useWorkspace();
  const [rows, setRows] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [warehouseState, setWarehouseState] = useState<any>(null);
  const [mappingDrafts, setMappingDrafts] = useState<Record<number, { productId: string; multiplier: number; isIgnored: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [productForm, setProductForm] = useState({
    name: '',
    sku: '',
    category: 'fg',
    unit: 'pcs',
    reorderThreshold: 0,
    hpp: 0,
    priceList: 0,
  });
  const [movement, setMovement] = useState({ productId: '', quantity: 0, notes: '' });

  const load = async () => {
    setLoading(true);
    try {
      const [inventory, movementRows, mappingRows, state] = await Promise.all([
        getWorkspaceWarehouseInventory(),
        getWorkspaceWarehouseMovements(),
        getWorkspaceWarehouseMappings(),
        getWorkspaceWarehouseState(),
      ]);
      setRows(inventory.rows || []);
      setMovements(movementRows || []);
      setMappings(mappingRows || []);
      setWarehouseState(state);
      setMappingDrafts(Object.fromEntries((mappingRows || []).map((row: any) => [
        Number(row.id),
        {
          productId: row.warehouse_product_id == null ? '' : String(row.warehouse_product_id),
          multiplier: Number(row.deduct_qty_multiplier || 1),
          isIgnored: Boolean(row.is_ignored),
        },
      ])));
    } catch (error: any) {
      setMessage(error?.message || 'Gagal memuat inventory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [activeWorkspace.id]);

  const summary = useMemo(() => ({
    products: rows.length,
    units: rows.reduce((sum, row) => sum + Number(row.current_stock || 0), 0),
    value: rows.reduce((sum, row) => sum + Number(row.stock_value || 0), 0),
    reorder: rows.filter((row) => row.needs_reorder).length,
  }), [rows]);

  const inputStyle = {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--input-bg)',
    color: 'var(--text)',
  } as const;

  const addProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    try {
      await createWorkspaceWarehouseProduct(productForm);
      setProductForm({ name: '', sku: '', category: 'fg', unit: 'pcs', reorderThreshold: 0, hpp: 0, priceList: 0 });
      setMessage('Produk Apurva ditambahkan ke gudang BTN.');
      await load();
    } catch (error: any) {
      setMessage(error?.message || 'Gagal menambahkan produk.');
    }
  };

  const saveMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    try {
      await adjustWorkspaceWarehouseStock({
        productId: Number(movement.productId),
        quantity: Number(movement.quantity),
        notes: movement.notes,
      });
      setMovement({ productId: '', quantity: 0, notes: '' });
      setMessage('Pergerakan stok tersimpan.');
      await load();
    } catch (error: any) {
      setMessage(error?.message || 'Gagal menyimpan pergerakan stok.');
    }
  };

  const syncMappings = async () => {
    setMessage('');
    try {
      const result = await syncWorkspaceWarehouseMappingNames();
      setMessage(`${result.names} nama produk Scalev diperiksa untuk workspace ini.`);
      await load();
    } catch (error: any) {
      setMessage(error?.message || 'Gagal sinkronisasi nama produk Scalev.');
    }
  };

  const saveMapping = async (mappingId: number) => {
    const draft = mappingDrafts[mappingId];
    if (!draft) return;
    setMessage('');
    try {
      await updateWorkspaceWarehouseMapping({
        id: mappingId,
        warehouseProductId: draft.productId ? Number(draft.productId) : null,
        multiplier: Number(draft.multiplier || 1),
        isIgnored: draft.isIgnored,
      });
      setMessage('Mapping Scalev workspace diperbarui.');
      await load();
    } catch (error: any) {
      setMessage(error?.message || 'Gagal memperbarui mapping.');
    }
  };

  const movementLabel = (type: string) => ({
    IN: 'Masuk',
    OUT: 'Keluar',
    ADJUST: 'Adjust',
    TRANSFER_IN: 'Transfer masuk',
    TRANSFER_OUT: 'Transfer keluar',
    DISPOSE: 'Dispose',
  }[type] || type);

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 1400, margin: '0 auto' }}>
      <div>
        <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>{activeWorkspace.name}</div>
        <h1 style={{ margin: '5px 0 0', fontSize: 24 }}>Warehouse · BTN</h1>
        <p style={{ color: 'var(--dim)', fontSize: 13, margin: '7px 0 0' }}>
          Warehouse independen. BTN hanya nama lokasi yang sama; produk, saldo, batch, mapping, mutasi, dan hak akses sepenuhnya milik workspace ini.
        </p>
        {warehouseState ? (
          <div style={{ marginTop: 9, color: warehouseState.isGoLive ? 'var(--green)' : 'var(--yellow)', fontSize: 12, fontWeight: 650 }}>
            {warehouseState.entity} · {warehouseState.warehouse} · {warehouseState.isGoLive
              ? 'Aktif'
              : warehouseState.goLiveAt
                ? `Go-live ${new Date(warehouseState.goLiveAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`
                : 'Jadwal go-live belum diatur'}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        {[
          ['Produk', summary.products],
          ['Total unit', summary.units.toLocaleString('id-ID')],
          ['Nilai stok', money.format(summary.value)],
          ['Perlu reorder', summary.reorder],
        ].map(([label, value]) => (
          <div key={label} style={{ border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 12, padding: 16 }}>
            <div style={{ color: 'var(--dim)', fontSize: 11, marginBottom: 7 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 750 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 14 }}>
        <form onSubmit={addProduct} style={{ display: 'grid', gap: 10, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 12, padding: 16 }}>
          <strong>Tambah produk workspace</strong>
          <input required placeholder="Nama produk" value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input placeholder="SKU" value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} style={inputStyle} />
            <select value={productForm.category} onChange={(event) => setProductForm({ ...productForm, category: event.target.value })} style={inputStyle}>
              {['fg', 'sachet', 'bonus', 'packaging', 'wip', 'wip_material', 'other'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input required placeholder="Satuan" value={productForm.unit} onChange={(event) => setProductForm({ ...productForm, unit: event.target.value })} style={inputStyle} />
            <input type="number" min="0" placeholder="Reorder threshold" value={productForm.reorderThreshold} onChange={(event) => setProductForm({ ...productForm, reorderThreshold: Number(event.target.value) })} style={inputStyle} />
            <input type="number" min="0" placeholder="HPP" value={productForm.hpp} onChange={(event) => setProductForm({ ...productForm, hpp: Number(event.target.value) })} style={inputStyle} />
            <input type="number" min="0" placeholder="Price list" value={productForm.priceList} onChange={(event) => setProductForm({ ...productForm, priceList: Number(event.target.value) })} style={inputStyle} />
          </div>
          <button style={{ border: 0, borderRadius: 8, padding: 10, background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Tambah produk</button>
        </form>

        <form onSubmit={saveMovement} style={{ display: 'grid', alignContent: 'start', gap: 10, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 12, padding: 16 }}>
          <strong>Catat stock masuk / keluar</strong>
          <select required value={movement.productId} onChange={(event) => setMovement({ ...movement, productId: event.target.value })} style={inputStyle}>
            <option value="">Pilih produk</option>
            {rows.map((row) => <option key={row.product_id} value={row.product_id}>{row.product_name} · stok {Number(row.current_stock || 0)}</option>)}
          </select>
          <input required type="number" value={movement.quantity} onChange={(event) => setMovement({ ...movement, quantity: Number(event.target.value) })} placeholder="+ untuk masuk, − untuk keluar" style={inputStyle} />
          <input value={movement.notes} onChange={(event) => setMovement({ ...movement, notes: event.target.value })} placeholder="Catatan / referensi" style={inputStyle} />
          <button style={{ border: 0, borderRadius: 8, padding: 10, background: 'var(--green)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Simpan mutasi</button>
        </form>
      </div>

      {message ? <div style={{ padding: 11, borderRadius: 8, background: 'var(--accent-subtle)', color: 'var(--text-secondary)', fontSize: 13 }}>{message}</div> : null}

      <div style={{ border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: 15, borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Inventory milik {activeWorkspace.name}</div>
        {loading ? <div style={{ padding: 32, color: 'var(--dim)', textAlign: 'center' }}>Memuat inventory…</div> : rows.length === 0 ? (
          <div style={{ padding: 40, color: 'var(--dim)', textAlign: 'center' }}>Belum ada produk atau stok dari workspace lama.</div>
        ) : (
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 13 }}>
              <thead><tr>{['Produk', 'SKU', 'Kategori', 'Lokasi', 'Stok', 'HPP', 'Nilai', 'Status'].map((title) => <th key={title} style={{ textAlign: 'left', color: 'var(--dim)', padding: 11, borderBottom: '1px solid var(--border)' }}>{title}</th>)}</tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.product_id}>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)', fontWeight: 650 }}>{row.product_name}</td>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)' }}>{row.sku || '—'}</td>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)' }}>{row.category}</td>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)' }}>{row.warehouse} · {row.entity}</td>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)', fontWeight: 700 }}>{Number(row.current_stock || 0).toLocaleString('id-ID')} {row.unit}</td>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)' }}>{money.format(Number(row.weighted_hpp || 0))}</td>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)' }}>{money.format(Number(row.stock_value || 0))}</td>
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)', color: row.needs_reorder ? 'var(--yellow)' : 'var(--green)' }}>{row.needs_reorder ? 'Reorder' : 'Aman'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: 15, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700 }}>Mapping produk Scalev</div>
            <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 3 }}>Hanya nama produk order dari workspace ini yang dapat diarahkan ke stok workspace ini.</div>
          </div>
          <button type="button" onClick={syncMappings} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer' }}>Sync nama</button>
        </div>
        {mappings.length === 0 ? (
          <div style={{ padding: 30, color: 'var(--dim)', textAlign: 'center' }}>Belum ada nama produk Scalev. Klik Sync nama setelah order masuk.</div>
        ) : (
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900, fontSize: 12 }}>
              <thead><tr>{['Nama di Scalev', 'Produk gudang', 'Multiplier', 'Abaikan', ''].map((title) => <th key={title} style={{ textAlign: 'left', color: 'var(--dim)', padding: 10, borderBottom: '1px solid var(--border)' }}>{title}</th>)}</tr></thead>
              <tbody>{mappings.map((mapping) => {
                const draft = mappingDrafts[Number(mapping.id)] || { productId: '', multiplier: 1, isIgnored: false };
                return (
                  <tr key={mapping.id}>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)', fontWeight: 650 }}>{mapping.scalev_product_name}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
                      <select value={draft.productId} disabled={draft.isIgnored} onChange={(event) => setMappingDrafts({ ...mappingDrafts, [mapping.id]: { ...draft, productId: event.target.value } })} style={{ ...inputStyle, padding: '7px 9px' }}>
                        <option value="">Belum dipetakan</option>
                        {rows.map((row) => <option key={row.product_id} value={row.product_id}>{row.product_name}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)', width: 110 }}><input type="number" min="0.000001" step="any" value={draft.multiplier} onChange={(event) => setMappingDrafts({ ...mappingDrafts, [mapping.id]: { ...draft, multiplier: Number(event.target.value) } })} style={{ ...inputStyle, padding: '7px 9px' }} /></td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}><input type="checkbox" checked={draft.isIgnored} onChange={(event) => setMappingDrafts({ ...mappingDrafts, [mapping.id]: { ...draft, isIgnored: event.target.checked } })} /></td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}><button type="button" onClick={() => saveMapping(Number(mapping.id))} style={{ border: 0, borderRadius: 7, padding: '7px 10px', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Simpan</button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: 15, borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Movement log workspace</div>
        {movements.length === 0 ? (
          <div style={{ padding: 30, color: 'var(--dim)', textAlign: 'center' }}>Belum ada pergerakan stok di workspace ini.</div>
        ) : (
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860, fontSize: 12 }}>
              <thead><tr>{['Waktu', 'Produk', 'Tipe', 'Qty', 'Saldo', 'Referensi', 'Catatan'].map((title) => <th key={title} style={{ textAlign: 'left', color: 'var(--dim)', padding: 10, borderBottom: '1px solid var(--border)' }}>{title}</th>)}</tr></thead>
              <tbody>{movements.map((row) => {
                const product = Array.isArray(row.warehouse_products) ? row.warehouse_products[0] : row.warehouse_products;
                return (
                  <tr key={row.id}>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{new Date(row.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)', fontWeight: 650 }}>{product?.name || '—'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>{movementLabel(row.movement_type)}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)', color: Number(row.quantity) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{Number(row.quantity) > 0 ? '+' : ''}{Number(row.quantity).toLocaleString('id-ID')}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>{Number(row.running_balance || 0).toLocaleString('id-ID')}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>{row.reference_id || row.reference_type || '—'}</td>
                    <td style={{ padding: 10, borderBottom: '1px solid var(--border)', color: 'var(--dim)' }}>{row.notes || '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
