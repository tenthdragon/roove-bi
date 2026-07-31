'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  adjustWorkspaceWarehouseStock,
  createWorkspaceWarehouseProduct,
  getWorkspaceWarehouseInventory,
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
      const result = await getWorkspaceWarehouseInventory();
      setRows(result.rows || []);
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

  return (
    <div style={{ display: 'grid', gap: 18, maxWidth: 1400, margin: '0 auto' }}>
      <div>
        <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>{activeWorkspace.name}</div>
        <h1 style={{ margin: '5px 0 0', fontSize: 24 }}>Warehouse · BTN</h1>
        <p style={{ color: 'var(--dim)', fontSize: 13, margin: '7px 0 0' }}>
          Lokasi fisik dipakai bersama. Produk, saldo, nilai stok, dan mutasi di bawah hanya milik workspace ini.
        </p>
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
                  <td style={{ padding: 11, borderBottom: '1px solid var(--border)' }}>BTN · APV</td>
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
    </div>
  );
}
