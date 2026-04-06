// app/dashboard/warehouse/page.tsx
// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  getWarehouseSummary,
  getWarehouseDailyStock,
  getWarehouseStockOpname,
  getWarehouseSOSummary,
  getWarehouseExpiring,
  getWarehouseAvailablePeriods,
} from '@/lib/warehouse-actions';
import {
  getStockBalance,
  getStockByBatch,
  getLedgerHistory,
  getDailyMovementSummary,
  getProducts,
  getBatches,
  recordStockIn,
  recordStockOut,
  recordStockRTS,
  recordDispose,
  recordTransfer,
  recordConversion,
  createBatch,
  // PO functions moved to ppic-actions (legacy import removed)
  type ConversionSource,
} from '@/lib/warehouse-ledger-actions';
import { getPurchaseOrders as getPOs, receivePOItems } from '@/lib/ppic-actions';
import { fmtCompact, fmtRupiah } from '@/lib/utils';
import { getCurrentProfile } from '@/lib/actions';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';

// ── Types ──

interface StockSummary {
  id: number; warehouse: string; period_month: number; period_year: number;
  product_name: string; category: string;
  first_day_stock: number; total_in: number; total_out: number; last_day_stock: number;
  expired_date: string | null; price_list: number; sub_total_value: number;
}

interface DailyStock {
  id: number; warehouse: string; date: string;
  product_name: string; category: string;
  stock_in: number; stock_out: number;
}

interface SORow {
  id: number; warehouse: string; opname_date: string; opname_label: string;
  product_name: string; category: string;
  sebelum_so: number; sesudah_so: number; selisih: number;
}

interface SOSummary {
  warehouse: string; opname_date: string; opname_label: string;
  item_count: number; total_abs_selisih: number; items_with_selisih: number;
  total_surplus: number; total_deficit: number;
}

interface ExpiringProduct {
  product_name: string; category: string; expired_date: string;
  last_day_stock: number; price_list: number; sub_total_value: number;
  warehouse: string; period_year: number; period_month: number;
  expiry_status: string; days_remaining: number;
}

// ── Constants ──

const SUB_TABS = [
  { id: 'stock', label: 'Saldo Stock' },
  { id: 'daily-summary', label: 'Daily Summary' },
  { id: 'batch', label: 'Batch & Expiry' },
  { id: 'stock-opname', label: 'Stock Opname' },
  { id: 'expired', label: 'Expired Monitor' },
  { id: 'ringkasan', label: 'Ringkasan (Lama)' },
  { id: 'harian', label: 'Harian (Lama)' },
  { id: 'ledger', label: 'Movement Log' },
];

const ID_MONTHS = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const MOVEMENT_LABELS: Record<string, { label: string; color: string }> = {
  'IN': { label: 'Masuk', color: 'var(--green)' },
  'OUT': { label: 'Keluar', color: '#f97316' },
  'ADJUST': { label: 'Adjust', color: '#8b5cf6' },
  'TRANSFER_IN': { label: 'Transfer In', color: '#06b6d4' },
  'TRANSFER_OUT': { label: 'Transfer Out', color: '#ec4899' },
  'DISPOSE': { label: 'Dispose', color: 'var(--red)' },
};

const CATEGORY_COLORS: Record<string, string> = {
  'fg': '#60a5fa',
  'sachet': '#f59e0b',
  'bonus': '#34d399',
  'packaging': '#fb923c',
  'other': '#94a3b8',
};

// ── Helpers ──

function shortDateID(d: string) {
  const parts = d.split('-');
  return `${parseInt(parts[2])}/${parseInt(parts[1])}`;
}

function fullDateID(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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

// ============================================================
// MAIN PAGE
// ============================================================

export default function WarehousePage() {
  const [activeTab, setActiveTab] = useState('stock');
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('');

  // Period selector (for legacy tabs)
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availablePeriods, setAvailablePeriods] = useState<{ period_month: number; period_year: number }[]>([]);

  // Legacy data
  const [summaryData, setSummaryData] = useState<StockSummary[]>([]);
  const [dailyData, setDailyData] = useState<DailyStock[]>([]);
  const [soData, setSOData] = useState<SORow[]>([]);
  const [soSummary, setSOSummary] = useState<SOSummary[]>([]);
  const [expiringData, setExpiringData] = useState<ExpiringProduct[]>([]);

  // New ledger data
  const [stockBalance, setStockBalance] = useState<any[]>([]);
  const [batchStock, setBatchStock] = useState<any[]>([]);
  const [ledgerHistory, setLedgerHistory] = useState<any[]>([]);
  const [mappingData, setMappingData] = useState<any[]>([]);
  const [dailySummary, setDailySummary] = useState<any[]>([]);
  const [dailySummaryDate, setDailySummaryDate] = useState(() => {
    const now = new Date();
    const wib = new Date(now.getTime() + (7 * 60 - now.getTimezoneOffset()) * 60000);
    return wib.toISOString().slice(0, 10);
  });

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [expandedSO, setExpandedSO] = useState<string | null>(null);
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('all');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshData = () => setRefreshKey(k => k + 1);

  // Load profile + available periods on mount
  useEffect(() => {
    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (profile) setUserRole(profile.role);
        const periods = await getWarehouseAvailablePeriods();
        setAvailablePeriods(periods);
        if (periods.length > 0) {
          setSelectedMonth(periods[0].period_month);
          setSelectedYear(periods[0].period_year);
        }
      } catch (e) {
        console.error('Failed to load:', e);
      }
      setLoading(false);
    })();
  }, []);

  // Load data when tab or period changes
  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        if (activeTab === 'stock') {
          const data = await getStockBalance();
          setStockBalance(data);
        } else if (activeTab === 'daily-summary') {
          const data = await getDailyMovementSummary(dailySummaryDate);
          setDailySummary(data);
        } else if (activeTab === 'ledger') {
          const data = await getLedgerHistory({ limit: 500 });
          setLedgerHistory(data);
        } else if (activeTab === 'batch') {
          const data = await getStockByBatch();
          setBatchStock(data);
        } else if (activeTab === 'mapping') {
          const data = await getScalevMappings();
          setMappingData(data);
        } else if (activeTab === 'ringkasan') {
          const data = await getWarehouseSummary(selectedMonth, selectedYear);
          setSummaryData(data);
        } else if (activeTab === 'harian') {
          const data = await getWarehouseDailyStock(selectedMonth, selectedYear);
          setDailyData(data);
        } else if (activeTab === 'stock-opname') {
          const [so, summary] = await Promise.all([
            getWarehouseStockOpname(),
            getWarehouseSOSummary(),
          ]);
          setSOData(so);
          setSOSummary(summary);
        } else if (activeTab === 'expired') {
          const data = await getWarehouseExpiring();
          setExpiringData(data);
        }
      } catch (e) {
        console.error('Failed to load data:', e);
      }
    })();
  }, [activeTab, selectedMonth, selectedYear, loading, refreshKey, dailySummaryDate]);

  // Categories for filter
  const categories = useMemo(() => {
    const cats = new Set<string>();
    summaryData.forEach(r => r.category && cats.add(r.category));
    dailyData.forEach(r => r.category && cats.add(r.category));
    stockBalance.forEach(r => r.category && cats.add(r.category));
    return Array.from(cats).sort();
  }, [summaryData, dailyData, stockBalance]);

  // Filtered data
  const filteredSummary = useMemo(() =>
    categoryFilter === 'all' ? summaryData : summaryData.filter(r => r.category === categoryFilter),
    [summaryData, categoryFilter]
  );

  const filteredDaily = useMemo(() =>
    categoryFilter === 'all' ? dailyData : dailyData.filter(r => r.category === categoryFilter),
    [dailyData, categoryFilter]
  );

  const filteredExpiring = useMemo(() =>
    expiryFilter === 'all' ? expiringData : expiringData.filter(r => r.expiry_status === expiryFilter),
    [expiringData, expiryFilter]
  );

  // Daily chart data
  const dailyChartData = useMemo(() => {
    const map = new Map<string, { date: string; in: number; out: number }>();
    filteredDaily.forEach(r => {
      const existing = map.get(r.date);
      if (existing) {
        existing.in += r.stock_in;
        existing.out += r.stock_out;
      } else {
        map.set(r.date, { date: r.date, in: r.stock_in, out: r.stock_out });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredDaily]);

  const isLegacyTab = ['ringkasan', 'harian'].includes(activeTab);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
      </div>
    );
  }

  // ── Period selector component ──
  const PeriodSelector = () => (
    <select
      value={`${selectedYear}-${selectedMonth}`}
      onChange={(e) => {
        const [y, m] = e.target.value.split('-').map(Number);
        setSelectedYear(y);
        setSelectedMonth(m);
      }}
      style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none',
      }}
    >
      {availablePeriods.map(p => (
        <option key={`${p.period_year}-${p.period_month}`} value={`${p.period_year}-${p.period_month}`}>
          {ID_MONTHS[p.period_month]} {p.period_year}
        </option>
      ))}
      {availablePeriods.length === 0 && (
        <option value={`${selectedYear}-${selectedMonth}`}>
          {ID_MONTHS[selectedMonth]} {selectedYear}
        </option>
      )}
    </select>
  );

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Gudang</h2>
        {isLegacyTab && <PeriodSelector />}
      </div>

      {/* Sub-tab navigation */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 20,
        borderBottom: '1px solid var(--border)', paddingBottom: 0,
        overflowX: 'auto',
      }}>
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: activeTab === t.id ? 'var(--border)' : 'transparent',
              color: activeTab === t.id ? '#60a5fa' : 'var(--dim)',
              borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'stock' && <StockBalanceTab data={stockBalance} searchQuery={searchQuery} setSearchQuery={setSearchQuery} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} onRefresh={refreshData} userRole={userRole} />}
      {activeTab === 'daily-summary' && <DailySummaryTab data={dailySummary} date={dailySummaryDate} setDate={setDailySummaryDate} />}
      {activeTab === 'ledger' && <LedgerTab data={ledgerHistory} typeFilter={ledgerTypeFilter} setTypeFilter={setLedgerTypeFilter} search={ledgerSearch} setSearch={setLedgerSearch} />}
      {activeTab === 'batch' && <BatchTab data={batchStock} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />}
      {activeTab === 'mapping' && <MappingTab data={mappingData} onRefresh={refreshData} />}
      {activeTab === 'ringkasan' && <RingkasanTab data={filteredSummary} categories={categories} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />}
      {activeTab === 'harian' && <HarianTab data={filteredDaily} chartData={dailyChartData} categories={categories} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />}
      {activeTab === 'stock-opname' && <StockOpnameTab soData={soData} soSummary={soSummary} expandedSO={expandedSO} setExpandedSO={setExpandedSO} />}
      {activeTab === 'expired' && <ExpiredTab data={filteredExpiring} expiryFilter={expiryFilter} setExpiryFilter={setExpiryFilter} allData={expiringData} />}
    </div>
  );
}

// ============================================================
// STOCK BALANCE TAB (NEW)
// ============================================================

function StockBalanceTab({ data, searchQuery, setSearchQuery, categoryFilter, setCategoryFilter, onRefresh, userRole }: {
  data: any[]; searchQuery: string; setSearchQuery: (v: string) => void;
  categoryFilter: string; setCategoryFilter: (v: string) => void;
  onRefresh: () => void; userRole: string;
}) {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'in' | 'out' | 'transfer' | 'convert' | 'dispose'>('in');

  // Role-based button visibility
  const canStockIn = !['warehouse_manager'].includes(userRole);
  const canWarehouseOps = !['ppic'].includes(userRole); // transfer, convert, out, dispose
  const [warehouseFilter, setWarehouseFilter] = useState('all');

  const categories = useMemo(() => {
    const cats = new Set<string>();
    data.forEach(r => r.category && cats.add(r.category));
    return Array.from(cats).sort();
  }, [data]);

  const warehouses = useMemo(() => {
    const whs = new Set<string>();
    data.forEach(r => {
      if (r.warehouse && r.entity) whs.add(`${r.warehouse} - ${r.entity}`);
    });
    return Array.from(whs).sort();
  }, [data]);

  const filtered = useMemo(() => {
    let result = data;
    if (warehouseFilter !== 'all') result = result.filter(r => `${r.warehouse} - ${r.entity}` === warehouseFilter);
    if (categoryFilter !== 'all') result = result.filter(r => r.category === categoryFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => r.product_name?.toLowerCase().includes(q));
    }
    return result;
  }, [data, categoryFilter, searchQuery, warehouseFilter]);

  const totalStock = filtered.reduce((s, r) => s + Number(r.current_stock || 0), 0);
  const totalValue = filtered.reduce((s, r) => s + Number(r.stock_value || 0), 0);
  const needsReorder = filtered.filter(r => r.needs_reorder).length;
  const productCount = filtered.length;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total Produk" value={String(productCount)} color="#8b5cf6" />
        <KPICard label="Total Stock" value={fmtCompact(totalStock)} color="var(--accent)" />
        <KPICard label="Nilai Stock" value={fmtRupiah(totalValue)} color="var(--green)" />
        <KPICard label="Perlu Reorder" value={String(needsReorder)} color={needsReorder > 0 ? 'var(--red)' : 'var(--green)'} />
      </div>

      {/* Action buttons + Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {canStockIn && <button onClick={() => { setModalMode('in'); setShowModal(true); }}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'var(--green)', color: '#fff' }}>
          + Stock Masuk
        </button>}
        {canWarehouseOps && <button onClick={() => { setModalMode('transfer'); setShowModal(true); }}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: '#06b6d4', color: '#fff' }}>
          Transfer
        </button>}
        {canWarehouseOps && <button onClick={() => { setModalMode('convert'); setShowModal(true); }}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: '#8b5cf6', color: '#fff' }}>
          Konversi
        </button>}
        {canWarehouseOps && <button onClick={() => { setModalMode('out'); setShowModal(true); }}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: '#f97316', color: '#fff' }}>
          Stock Keluar
        </button>}
        {canWarehouseOps && <button onClick={() => { setModalMode('dispose'); setShowModal(true); }}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: 'var(--red)', color: '#fff' }}>
          Dispose
        </button>}
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Cari produk..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', minWidth: 200 }} />
        <select value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="all">Semua Gudang</option>
          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="all">Semua Kategori</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Stock Movement Modal */}
      {showModal && (
        <StockMovementModal mode={modalMode} onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); onRefresh(); }} />
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['No', 'Produk', 'Kategori', 'Gudang', 'Stock', 'Satuan', 'Harga', 'Nilai', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: ['Produk', 'Kategori', 'Gudang', 'Satuan', 'Status'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.product_id} style={{ borderBottom: '1px solid var(--bg-deep)', background: r.needs_reorder ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{i + 1}</td>
                <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{r.product_name}</td>
                <td style={{ padding: '6px 10px' }}>
                  <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: CATEGORY_COLORS[r.category] ? `${CATEGORY_COLORS[r.category]}20` : 'var(--bg-deep)', color: CATEGORY_COLORS[r.category] || 'var(--text-secondary)' }}>{r.category}</span>
                </td>
                <td style={{ padding: '6px 10px', fontSize: 11 }}>
                  <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'var(--bg-deep)', color: 'var(--text)' }}>{r.warehouse} - {r.entity}</span>
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: Number(r.current_stock) < 0 ? 'var(--red)' : 'var(--text)' }}>
                  {Number(r.current_stock).toLocaleString('id-ID')}
                </td>
                <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11 }}>{r.unit}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{r.price_list > 0 ? fmtRupiah(r.price_list) : '-'}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{r.stock_value > 0 ? fmtRupiah(r.stock_value) : '-'}</td>
                <td style={{ padding: '6px 10px' }}>
                  {r.needs_reorder ? (
                    <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--badge-red-bg)', color: '#fca5a5' }}>Reorder</span>
                  ) : (
                    <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--badge-green-bg)', color: '#6ee7b7' }}>OK</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada data stock. Tambahkan batch dan catat movement untuk melihat saldo.</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={4} style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--text)' }}>Total</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{totalStock.toLocaleString('id-ID')}</td>
                <td /><td />
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{fmtRupiah(totalValue)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

// ============================================================
// STOCK MOVEMENT MODAL
// ============================================================

const inputStyle = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%',
};

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--dim)', marginBottom: 4, display: 'block' };

function StockMovementModal({ mode, onClose, onSuccess }: {
  mode: 'in' | 'out' | 'transfer' | 'convert' | 'dispose'; onClose: () => void; onSuccess: () => void;
}) {
  if (mode === 'convert') return <ConvertModal onClose={onClose} onSuccess={onSuccess} />;
  return <SimpleMovementModal mode={mode} onClose={onClose} onSuccess={onSuccess} />;
}

// ── Simple modal for IN/OUT/TRANSFER/DISPOSE ──

function SimpleMovementModal({ mode, onClose, onSuccess }: {
  mode: 'in' | 'out' | 'transfer' | 'dispose'; onClose: () => void; onSuccess: () => void;
}) {
  const [products, setProducts] = useState<any[]>([]);
  const [batches, setBatchList] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [batchCode, setBatchCode] = useState('');
  const [expiredDate, setExpiredDate] = useState('');
  const [targetEntity, setTargetEntity] = useState('');
  // Stock Masuk specific
  const [inType, setInType] = useState<'new' | 'rts' | null>(null);
  const [selectedPO, setSelectedPO] = useState('');
  const [resiNumber, setResiNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const cfgMap: Record<string, { title: string; color: string; label: string; desc: string }> = {
    in: { title: 'Stock Masuk', color: 'var(--green)', label: 'Masuk', desc: '' },
    out: { title: 'Stock Keluar', color: '#f97316', label: 'Keluar', desc: 'Barang keluar (sample, lain-lain). FIFO otomatis jika tidak pilih batch.' },
    transfer: { title: 'Transfer Antar Entity', color: '#06b6d4', label: 'Transfer', desc: 'Pindahkan stock ke entity lain di gudang yang sama' },
    dispose: { title: 'Dispose Stock', color: 'var(--red)', label: 'Dispose', desc: 'Buang barang expired atau rusak' },
  };
  const cfg = cfgMap[mode];

  useEffect(() => {
    (async () => {
      try {
        const prods = await getProducts();
        setProducts(prods);
        if (mode === 'in') {
          // Load POs with submitted/partial status and flatten items
          const [submitted, partial] = await Promise.all([
            getPOs({ status: 'submitted' }),
            getPOs({ status: 'partial' }),
          ]);
          // Flatten to PO items with remaining qty > 0
          const allPOs = [...submitted, ...partial];
          const poItems = allPOs.flatMap(po =>
            (po.warehouse_po_items || [])
              .filter((item: any) => Number(item.quantity_requested) - Number(item.quantity_received) > 0)
              .map((item: any) => ({
                id: `${po.id}-${item.id}`,
                po_id: po.id,
                po_item_id: item.id,
                po_number: po.po_number,
                vendor_name: po.warehouse_vendors?.name,
                warehouse_product_id: item.warehouse_product_id,
                product_name: item.warehouse_products?.name,
                quantity_requested: Number(item.quantity_requested),
                quantity_received: Number(item.quantity_received),
                remaining: Number(item.quantity_requested) - Number(item.quantity_received),
              }))
          );
          setPos(poItems);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!selectedProduct) { setBatchList([]); return; }
    (async () => { try { setBatchList(await getBatches(Number(selectedProduct))); } catch {} })();
  }, [selectedProduct]);

  const sourceProduct = products.find(p => String(p.id) === selectedProduct);
  const entities = ['RTI', 'RLB', 'RLT', 'JHN'].filter(e => e !== sourceProduct?.entity);
  const needsExpiry = sourceProduct && ['fg', 'sachet'].includes(sourceProduct.category);

  // When PO item selected, auto-fill product and qty
  const handlePOSelect = (poItemKey: string) => {
    setSelectedPO(poItemKey);
    if (poItemKey) {
      const poItem = pos.find(p => p.id === poItemKey);
      if (poItem) {
        setSelectedProduct(String(poItem.warehouse_product_id));
        setQuantity(String(poItem.remaining));
      }
    }
  };

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    const qty = Number(quantity); const pid = Number(selectedProduct);
    if (!pid) { setError('Pilih produk'); return; }
    if (!qty || qty <= 0) { setError('Quantity harus > 0'); return; }

    setSubmitting(true);
    try {
      if (mode === 'in' && inType === 'new') {
        // Barang Baru — batch wajib
        if (!batchCode.trim()) { setError('Kode batch wajib diisi'); setSubmitting(false); return; }
        if (needsExpiry && !expiredDate) { setError('Expired date wajib untuk produk FG/sachet'); setSubmitting(false); return; }

        if (selectedPO) {
          // Link to PO — use new multi-item PO system
          const poItem = pos.find(p => p.id === selectedPO);
          if (poItem) {
            await receivePOItems(poItem.po_id, [{
              poItemId: poItem.po_item_id,
              quantityReceived: qty,
              batchCode: batchCode.trim(),
              expiredDate: expiredDate || null,
            }]);
            setSuccess(`Stock masuk: ${qty} unit (${poItem.po_number}, batch: ${batchCode})`);
          }
        } else {
          await createBatch(pid, batchCode.trim(), expiredDate || null, qty);
          setSuccess(`Stock masuk: ${qty} unit (batch: ${batchCode})`);
        }
      } else if (mode === 'in' && inType === 'rts') {
        // RTS — batch existing wajib, resi wajib
        if (!selectedBatch) { setError('Pilih batch untuk RTS'); setSubmitting(false); return; }
        if (!resiNumber.trim()) { setError('Nomor resi wajib untuk RTS'); setSubmitting(false); return; }
        await recordStockRTS(pid, Number(selectedBatch), qty, resiNumber.trim(), notes || undefined);
        setSuccess(`RTS: ${qty} unit kembali ke batch`);
      } else if (mode === 'out') {
        await recordStockOut(pid, selectedBatch ? Number(selectedBatch) : null, qty, 'manual', undefined, notes || undefined);
        setSuccess(`Stock keluar: ${qty} unit${selectedBatch ? '' : ' (FIFO)'}`);
      } else if (mode === 'transfer') {
        if (!targetEntity) { setError('Pilih entity tujuan'); setSubmitting(false); return; }
        await recordTransfer(pid, selectedBatch ? Number(selectedBatch) : null, qty, sourceProduct.entity, targetEntity, sourceProduct.warehouse, sourceProduct.warehouse, notes || undefined);
        setSuccess(`Transfer: ${qty} unit → ${targetEntity}`);
      } else if (mode === 'dispose') {
        await recordDispose(pid, selectedBatch ? Number(selectedBatch) : null, qty, notes || undefined);
        setSuccess(`Dispose: ${qty} unit`);
      }
      setTimeout(onSuccess, 800);
    } catch (e: any) { setError(e.message || 'Gagal menyimpan'); }
    setSubmitting(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: cfg.color }}>{cfg.title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18, cursor: 'pointer', padding: 4 }}>&#10005;</button>
        </div>

        {/* Stock Masuk: pilih tipe dulu */}
        {mode === 'in' && !inType && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 16 }}>Pilih tipe barang masuk</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setInType('new')}
                style={{ flex: 1, padding: '16px 12px', borderRadius: 12, border: '2px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>📦</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Barang Baru</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>Dari vendor / produksi</div>
              </button>
              <button onClick={() => setInType('rts')}
                style={{ flex: 1, padding: '16px 12px', borderRadius: 12, border: '2px solid var(--border)', background: 'transparent', cursor: 'pointer', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>↩️</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>RTS (Retur)</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>Paket gagal kirim kembali</div>
              </button>
            </div>
          </div>
        )}

        {/* Show form after type selected (or for non-in modes) */}
        {(mode !== 'in' || inType) && (
          <>
            {mode === 'in' && inType && (
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 16 }}>
                {inType === 'new' ? 'Barang baru dari vendor/produksi — batch wajib' : 'Retur marketplace — pilih batch existing'}
                <button onClick={() => setInType(null)} style={{ marginLeft: 8, fontSize: 10, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Ubah tipe</button>
              </div>
            )}
            {mode !== 'in' && cfg.desc && <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 16 }}>{cfg.desc}</div>}

            {/* PO Reference (Barang Baru only) */}
            {mode === 'in' && inType === 'new' && pos.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>PO Reference (opsional)</label>
                <select value={selectedPO} onChange={(e) => handlePOSelect(e.target.value)} style={inputStyle}>
                  <option value="">-- Tanpa PO --</option>
                  {pos.map(po => (
                    <option key={po.id} value={po.id}>
                      {po.po_number} — {po.product_name} (sisa: {po.remaining}) [{po.vendor_name}]
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Produk */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Produk *</label>
              <select value={selectedProduct} onChange={(e) => { setSelectedProduct(e.target.value); setSelectedBatch(''); }} style={inputStyle}>
                <option value="">-- Pilih Produk --</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.category}) [{p.warehouse}-{p.entity}]</option>)}
              </select>
            </div>

            {/* Barang Baru: batch code + expired (wajib) */}
            {mode === 'in' && inType === 'new' && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Batch Code * (dari label produsen)</label>
                <input type="text" placeholder="e.g. LOT-20260301" value={batchCode} onChange={(e) => setBatchCode(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                <label style={labelStyle}>Expired Date {needsExpiry ? '*' : '(opsional)'}</label>
                <input type="date" value={expiredDate} onChange={(e) => setExpiredDate(e.target.value)} style={inputStyle} />
              </div>
            )}

            {/* RTS: batch existing + resi */}
            {mode === 'in' && inType === 'rts' && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Batch * (barang kembali ke batch mana)</label>
                  <select value={selectedBatch} onChange={(e) => setSelectedBatch(e.target.value)} style={inputStyle}>
                    <option value="">-- Pilih Batch --</option>
                    {batches.map(b => <option key={b.id} value={b.id}>{b.batch_code} (qty: {b.current_qty}{b.expired_date ? `, exp: ${b.expired_date}` : ''})</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Nomor Resi / Order ID *</label>
                  <input type="text" placeholder="e.g. SPXID061515489801" value={resiNumber} onChange={(e) => setResiNumber(e.target.value)} style={inputStyle} />
                </div>
              </>
            )}

            {/* Out/Dispose/Transfer: batch selector */}
            {['out', 'dispose', 'transfer'].includes(mode) && batches.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Batch {mode === 'out' ? '(kosongkan untuk FIFO otomatis)' : ''}</label>
                <select value={selectedBatch} onChange={(e) => setSelectedBatch(e.target.value)} style={inputStyle}>
                  <option value="">{mode === 'out' ? '-- FIFO (batch terlama duluan) --' : '-- Tanpa Batch --'}</option>
                  {batches.map(b => <option key={b.id} value={b.id}>{b.batch_code} (qty: {b.current_qty}{b.expired_date ? `, exp: ${b.expired_date}` : ''})</option>)}
                </select>
              </div>
            )}

            {/* Quantity */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Quantity *</label>
              <input type="number" min="1" placeholder="Jumlah" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={inputStyle} />
            </div>

            {/* Transfer: entity tujuan */}
            {mode === 'transfer' && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Entity Tujuan *</label>
                <select value={targetEntity} onChange={(e) => setTargetEntity(e.target.value)} style={inputStyle}>
                  <option value="">-- Pilih Entity --</option>
                  {entities.map(e => <option key={e} value={e}>{sourceProduct?.warehouse || 'BTN'} - {e}</option>)}
                </select>
              </div>
            )}

            {/* Notes */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Catatan</label>
              <input type="text" placeholder="Opsional" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            </div>

            {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: 12, marginBottom: 12 }}>{error}</div>}
            {success && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: '#6ee7b7', fontSize: 12, marginBottom: 12 }}>{success}</div>}

            <button onClick={handleSubmit} disabled={submitting}
              style={{ width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none', cursor: submitting ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700, background: cfg.color, color: '#fff', opacity: submitting ? 0.7 : 1 }}>
              {submitting ? 'Menyimpan...' : `Simpan ${cfg.label}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Konversi modal: multi-source → single target ──

function ConvertModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [search, setSearch] = useState('');
  const [sources, setSources] = useState<{ productId: number; productName: string; quantity: string }[]>([]);
  const [targetProduct, setTargetProduct] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [targetName, setTargetName] = useState('');
  const [targetQty, setTargetQty] = useState('');
  const [targetBatchCode, setTargetBatchCode] = useState('');
  const [targetExpiredDate, setTargetExpiredDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => { (async () => { try { setProducts(await getProducts()); } catch {} })(); }, []);

  // Available entities from products
  const entities = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => { if (p.entity && p.warehouse) set.add(`${p.warehouse} - ${p.entity}`); });
    return Array.from(set).sort();
  }, [products]);

  // Products filtered by selected entity
  const entityProducts = useMemo(() => {
    if (!selectedEntity) return [];
    const [wh, ent] = selectedEntity.split(' - ');
    return products.filter(p => p.warehouse === wh && p.entity === ent);
  }, [products, selectedEntity]);

  // Source search within entity
  const filteredSource = useMemo(() => {
    if (!search) return entityProducts;
    const q = search.toLowerCase();
    return entityProducts.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [entityProducts, search]);

  // Target search within entity
  const filteredTarget = useMemo(() => {
    if (!targetSearch) return [];
    const q = targetSearch.toLowerCase();
    return entityProducts.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }, [entityProducts, targetSearch]);

  const addSource = (p: any) => {
    if (sources.find(s => s.productId === p.id)) return;
    setSources([...sources, { productId: p.id, productName: p.name, quantity: '' }]);
  };
  const removeSource = (pid: number) => setSources(sources.filter(s => s.productId !== pid));
  const updateSourceQty = (pid: number, qty: string) => setSources(sources.map(s => s.productId === pid ? { ...s, quantity: qty } : s));

  const selectTarget = (p: any) => {
    setTargetProduct(String(p.id));
    setTargetName(p.name);
    setTargetSearch('');
  };

  // Reset sources/target when entity changes
  const handleEntityChange = (val: string) => {
    setSelectedEntity(val);
    setSources([]);
    setTargetProduct('');
    setTargetName('');
    setSearch('');
    setTargetSearch('');
  };

  // Summary text
  const summaryReady = sources.length > 0 && sources.every(s => Number(s.quantity) > 0) && targetProduct && Number(targetQty) > 0;

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    if (!selectedEntity) { setError('Pilih gudang/entity'); return; }
    if (sources.length === 0) { setError('Tambahkan minimal 1 bahan asal'); return; }
    const tpid = Number(targetProduct);
    const tqty = Number(targetQty);
    if (!tpid) { setError('Pilih produk tujuan'); return; }
    if (!tqty || tqty <= 0) { setError('Qty tujuan harus > 0'); return; }

    const convSources: ConversionSource[] = [];
    for (const s of sources) {
      const qty = Number(s.quantity);
      if (!qty || qty <= 0) { setError(`Qty untuk ${s.productName} harus > 0`); return; }
      convSources.push({ productId: s.productId, quantity: qty });
    }

    setSubmitting(true);
    try {
      await recordConversion(convSources, tpid, tqty, targetBatchCode || undefined, targetExpiredDate || null, notes || undefined);
      setSuccess('Konversi berhasil!');
      setTimeout(onSuccess, 800);
    } catch (e: any) { setError(e.message || 'Gagal menyimpan'); }
    setSubmitting(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#8b5cf6' }}>Konversi Produk</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18, cursor: 'pointer', padding: 4 }}>&#10005;</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 16 }}>Gabungkan bahan menjadi 1 produk di dalam gudang yang sama</div>

        {/* ── Entity selector ── */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Gudang *</label>
          <select value={selectedEntity} onChange={(e) => handleEntityChange(e.target.value)} style={inputStyle}>
            <option value="">-- Pilih Gudang --</option>
            {entities.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {selectedEntity && (
          <>
            {/* ── Source: search + add ── */}
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Bahan Asal</div>
            <input type="text" placeholder="Cari produk bahan..." value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, marginBottom: 8 }} />

            {search && (
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10 }}>
                {filteredSource.slice(0, 20).map(p => {
                  const isAdded = sources.some(s => s.productId === p.id);
                  return (
                    <div key={p.id} onClick={() => !isAdded && addSource(p)}
                      style={{ padding: '6px 10px', fontSize: 12, cursor: isAdded ? 'default' : 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        borderBottom: '1px solid var(--bg-deep)', background: isAdded ? 'var(--bg-deep)' : 'transparent', opacity: isAdded ? 0.5 : 1 }}>
                      <span style={{ color: 'var(--text)' }}>{p.name} <span style={{ color: 'var(--dim)', fontSize: 10 }}>({p.category})</span></span>
                      {isAdded ? <span style={{ fontSize: 10, color: 'var(--dim)' }}>Ditambahkan</span> : <span style={{ fontSize: 10, color: '#8b5cf6' }}>+ Tambah</span>}
                    </div>
                  );
                })}
                {filteredSource.length === 0 && <div style={{ padding: 12, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>Tidak ditemukan</div>}
              </div>
            )}

            {sources.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {sources.map(s => (
                  <div key={s.productId} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <button onClick={() => removeSource(s.productId)}
                      style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 14, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}>&#10005;</button>
                    <div style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.productName}</div>
                    <input type="number" min="1" placeholder="Qty" value={s.quantity} onChange={(e) => updateSourceQty(s.productId, e.target.value)}
                      style={{ ...inputStyle, width: 80, flex: 'none', textAlign: 'right' }} />
                  </div>
                ))}
              </div>
            )}
            {sources.length === 0 && !search && (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--dim)', fontSize: 12, background: 'var(--bg-deep)', borderRadius: 8, marginBottom: 14 }}>
                Ketik di search untuk menambahkan bahan
              </div>
            )}

            {/* ── Target ── */}
            <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0', paddingTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Hasil Konversi</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Produk Tujuan *</label>
              {targetProduct ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-deep)', borderRadius: 8, fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{targetName}</div>
                  <button onClick={() => { setTargetProduct(''); setTargetName(''); }}
                    style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 14, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}>&#10005;</button>
                </div>
              ) : (
                <>
                  <input type="text" placeholder="Cari produk tujuan..." value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} style={inputStyle} />
                  {targetSearch && (
                    <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4 }}>
                      {filteredTarget.slice(0, 20).map(p => (
                        <div key={p.id} onClick={() => selectTarget(p)}
                          style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--bg-deep)' }}>
                          <span style={{ color: 'var(--text)' }}>{p.name} <span style={{ color: 'var(--dim)', fontSize: 10 }}>({p.category})</span></span>
                        </div>
                      ))}
                      {filteredTarget.length === 0 && <div style={{ padding: 12, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>Tidak ditemukan</div>}
                    </div>
                  )}
                </>
              )}
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Qty Hasil *</label>
              <input type="number" min="1" placeholder="Jumlah hasil" value={targetQty} onChange={(e) => setTargetQty(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Batch Tujuan</label>
                <input type="text" placeholder="Kode batch (opsional)" value={targetBatchCode} onChange={(e) => setTargetBatchCode(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Expired</label>
                <input type="date" value={targetExpiredDate} onChange={(e) => setTargetExpiredDate(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Catatan</label>
              <input type="text" placeholder="Opsional" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            </div>
          </>
        )}

        {/* ── Summary ── */}
        {summaryReady && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-deep)', border: '1px solid var(--border)', marginBottom: 14, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>Ringkasan Konversi</div>
            {sources.map(s => (
              <div key={s.productId} style={{ color: '#f97316', marginBottom: 2 }}>
                - {s.productName} <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>x{Number(s.quantity).toLocaleString('id-ID')}</span>
              </div>
            ))}
            <div style={{ color: 'var(--dim)', margin: '4px 0' }}>menjadi</div>
            <div style={{ color: 'var(--green)', fontWeight: 600 }}>
              + {targetName} <span style={{ fontFamily: 'monospace' }}>x{Number(targetQty).toLocaleString('id-ID')}</span>
            </div>
            <div style={{ color: 'var(--dim)', fontSize: 10, marginTop: 4 }}>di gudang {selectedEntity}</div>
          </div>
        )}

        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#fca5a5', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {success && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: '#6ee7b7', fontSize: 12, marginBottom: 12 }}>{success}</div>}

        <button onClick={handleSubmit} disabled={submitting || !selectedEntity}
          style={{ width: '100%', padding: '10px 16px', borderRadius: 8, border: 'none', cursor: submitting || !selectedEntity ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, background: '#8b5cf6', color: '#fff', opacity: submitting || !selectedEntity ? 0.5 : 1 }}>
          {submitting ? 'Menyimpan...' : 'Simpan Konversi'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// MAPPING SCALEV TAB
// ============================================================

function MappingTab({ data, onRefresh }: { data: any[]; onRefresh: () => void }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [freqMap, setFreqMap] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [priceTiers, setPriceTiers] = useState<Record<string, { price: number; count: number }[]>>({});

  useEffect(() => { (async () => { try { setProducts(await getProducts()); } catch {} })(); }, []);
  useEffect(() => { (async () => { try { setFreqMap(await getScalevFrequencies()); } catch {} })(); }, []);
  useEffect(() => { (async () => { try { setPriceTiers(await getScalevPriceTiers()); } catch {} })(); }, []);

  // Auto-suggest: find best matching warehouse product for unmapped items
  const getSuggestion = (scalevName: string) => {
    if (!products.length) return null;
    const sn = scalevName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const snWords = sn.split(' ');

    let bestMatch: any = null;
    let bestScore = 0;

    for (const p of products) {
      const pn = p.name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
      const pnWords = pn.split(' ');

      // Count matching words
      let matches = 0;
      for (const sw of snWords) {
        if (sw.length < 2) continue;
        for (const pw of pnWords) {
          if (pw.includes(sw) || sw.includes(pw)) { matches++; break; }
        }
      }

      const score = matches / Math.max(snWords.length, pnWords.length);
      if (score > bestScore && score >= 0.3) {
        bestScore = score;
        bestMatch = { ...p, score };
      }
    }
    return bestMatch;
  };

  // Merge frequency into data
  const dataWithFreq = useMemo(() =>
    data.map(r => ({ ...r, frequency: freqMap[r.scalev_product_name] || 0 })),
    [data, freqMap]
  );

  const filtered = useMemo(() => {
    let result = dataWithFreq;
    if (filter === 'mapped') result = result.filter(r => r.warehouse_product_id && !r.is_ignored);
    if (filter === 'unmapped') result = result.filter(r => !r.warehouse_product_id && !r.is_ignored);
    if (filter === 'ignored') result = result.filter(r => r.is_ignored);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.scalev_product_name?.toLowerCase().includes(q));
    }
    return result.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
  }, [data, filter, search]);

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

  const handleMap = async (mappingId: number, productId: number | null) => {
    setSaving(true);
    try {
      await updateScalevMapping(mappingId, productId, undefined, false);
      setEditingId(null);
      setProductSearch('');
      onRefresh();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleIgnore = async (mappingId: number) => {
    setSaving(true);
    try {
      await updateScalevMapping(mappingId, null, undefined, true);
      onRefresh();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleUnignore = async (mappingId: number) => {
    setSaving(true);
    try {
      await updateScalevMapping(mappingId, null, undefined, false);
      onRefresh();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncScalevProductNames();
      onRefresh();
    } catch (e) { console.error(e); }
    setSyncing(false);
  };

  return (
    <>
      {/* KPI */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total Produk Scalev" value={String(counts.all)} color="var(--accent)" />
        <KPICard label="Mapped" value={String(counts.mapped)} color="var(--green)" />
        <KPICard label="Unmapped" value={String(counts.unmapped)} color={counts.unmapped > 0 ? 'var(--red)' : 'var(--green)'} />
        <KPICard label="Ignored" value={String(counts.ignored)} color="var(--dim)" />
      </div>

      {/* Filter + Search + Sync */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'unmapped', 'mapped', 'ignored'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`, background: filter === f ? 'var(--accent)' : 'transparent', color: filter === f ? '#fff' : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
            {f === 'all' ? 'Semua' : f === 'unmapped' ? 'Belum Map' : f === 'mapped' ? 'Sudah Map' : 'Ignored'} ({counts[f]})
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Cari nama Scalev..." value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', minWidth: 200 }} />
        <button onClick={handleSync} disabled={syncing}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: syncing ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, background: 'transparent', color: 'var(--dim)' }}>
          {syncing ? 'Syncing...' : 'Sync Baru'}
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Scalev Product Name', 'Frek', 'Harga/unit', 'Mapped To', 'Qty', 'Status', 'Action'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: ['Scalev Product Name', 'Mapped To', 'Harga/unit', 'Status', 'Action'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const isEditing = editingId === r.id;
              const wp = r.warehouse_products;
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.scalev_product_name}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 11 }}>
                    {(r.frequency || 0).toLocaleString('id-ID')}
                  </td>
                  <td style={{ padding: '6px 10px', fontSize: 10 }}>
                    {(priceTiers[r.scalev_product_name] || []).slice(0, 3).map((t, i) => (
                      <div key={i} style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{Math.round(t.price).toLocaleString('id-ID')}</span>
                        <span style={{ color: 'var(--dim)' }}> ({t.count.toLocaleString('id-ID')}x)</span>
                      </div>
                    ))}
                  </td>
                  <td style={{ padding: '6px 10px', minWidth: 250 }}>
                    {isEditing ? (
                      <div>
                        <input type="text" placeholder="Cari warehouse product..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                          style={{ ...inputStyle, marginBottom: 4 }} autoFocus />
                        {productSearch && (
                          <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                            <div onClick={() => handleMap(r.id, null)}
                              style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--dim)', borderBottom: '1px solid var(--bg-deep)' }}>
                              -- Hapus Mapping --
                            </div>
                            {filteredProducts.slice(0, 15).map(p => (
                              <div key={p.id} onClick={() => handleMap(r.id, p.id)}
                                style={{ padding: '4px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text)', borderBottom: '1px solid var(--bg-deep)' }}>
                                {p.name} <span style={{ color: 'var(--dim)' }}>({p.category}) [{p.warehouse}-{p.entity}]</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button onClick={() => { setEditingId(null); setProductSearch(''); }}
                          style={{ marginTop: 4, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 10, cursor: 'pointer' }}>
                          Batal
                        </button>
                      </div>
                    ) : (
                      (() => {
                        if (wp) return <span style={{ color: 'var(--text)', fontSize: 12 }}>{wp.name} [{wp.warehouse}-{wp.entity}]</span>;
                        if (r.is_ignored) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>;
                        const suggestion = getSuggestion(r.scalev_product_name);
                        return suggestion ? (
                          <button onClick={() => handleMap(r.id, suggestion.id)} disabled={saving}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px dashed #8b5cf6', background: 'rgba(139,92,246,0.08)', color: '#c4b5fd', fontSize: 11, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                            <span style={{ fontSize: 9, color: 'var(--dim)', display: 'block', marginBottom: 2 }}>Suggestion ({Math.round(suggestion.score * 100)}%)</span>
                            {suggestion.name} <span style={{ color: 'var(--dim)' }}>[{suggestion.warehouse}-{suggestion.entity}]</span>
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Belum dimapping</span>
                        );
                      })()
                    )}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {r.deduct_qty_multiplier}x
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {r.is_ignored ? (
                      <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--bg-deep)', color: 'var(--dim)' }}>Ignored</span>
                    ) : r.warehouse_product_id ? (
                      <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--badge-green-bg)', color: '#6ee7b7' }}>Mapped</span>
                    ) : (
                      <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--badge-red-bg)', color: '#fca5a5' }}>Unmapped</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!isEditing && !r.is_ignored && (
                        <button onClick={() => setEditingId(r.id)} disabled={saving}
                          style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>
                          {r.warehouse_product_id ? 'Ubah' : 'Map'}
                        </button>
                      )}
                      {!r.is_ignored && !r.warehouse_product_id && (
                        <button onClick={() => handleIgnore(r.id)} disabled={saving}
                          style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 10, cursor: 'pointer' }}>
                          Ignore
                        </button>
                      )}
                      {r.is_ignored && (
                        <button onClick={() => handleUnignore(r.id)} disabled={saving}
                          style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', fontSize: 10, cursor: 'pointer' }}>
                          Unignore
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada data mapping</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// LEDGER (MOVEMENT LOG) TAB (NEW)
// ============================================================

// ============================================================
// DAILY SUMMARY TAB
// ============================================================
function DailySummaryTab({ data, date, setDate }: {
  data: any[]; date: string; setDate: (v: string) => void;
}) {
  const [entityFilter, setEntityFilter] = useState('all');

  const entities = useMemo(() => {
    const set = new Set<string>();
    data.forEach(r => set.add(r.entity));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (entityFilter === 'all') return data;
    return data.filter(r => r.entity === entityFilter);
  }, [data, entityFilter]);

  const totals = useMemo(() => {
    return filtered.reduce((acc, r) => ({
      total_in: acc.total_in + r.total_in,
      total_out: acc.total_out + r.total_out,
      total_adjust: acc.total_adjust + r.total_adjust,
      net_change: acc.net_change + r.net_change,
    }), { total_in: 0, total_out: 0, total_adjust: 0, net_change: 0 });
  }, [filtered]);

  return (
    <>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13 }} />
        <button onClick={() => setEntityFilter('all')}
          style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${entityFilter === 'all' ? 'var(--accent)' : 'var(--border)'}`, background: entityFilter === 'all' ? 'var(--accent)' : 'transparent', color: entityFilter === 'all' ? '#fff' : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
          Semua ({data.length})
        </button>
        {entities.map(e => (
          <button key={e} onClick={() => setEntityFilter(entityFilter === e ? 'all' : e)}
            style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${entityFilter === e ? 'var(--accent)' : 'var(--border)'}`, background: entityFilter === e ? 'var(--accent)' : 'transparent', color: entityFilter === e ? '#fff' : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
            {e} ({data.filter(r => r.entity === e).length})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          Tidak ada pergerakan barang pada {date}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Produk', 'Entity', 'Kategori', 'IN', 'OUT', 'Adjust', 'Net'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: ['Produk', 'Entity', 'Kategori'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.product_id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 500 }}>{r.product_name}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11 }}>{r.entity}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: `${CATEGORY_COLORS[r.category] || '#94a3b8'}20`, color: CATEGORY_COLORS[r.category] || '#94a3b8' }}>
                      {r.category}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.total_in > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                    {r.total_in > 0 ? `+${r.total_in.toLocaleString('id-ID')}` : '-'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.total_out < 0 ? '#f97316' : 'var(--text-muted)' }}>
                    {r.total_out < 0 ? r.total_out.toLocaleString('id-ID') : '-'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.total_adjust !== 0 ? '#8b5cf6' : 'var(--text-muted)' }}>
                    {r.total_adjust !== 0 ? (r.total_adjust > 0 ? '+' : '') + r.total_adjust.toLocaleString('id-ID') : '-'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: r.net_change > 0 ? 'var(--green)' : r.net_change < 0 ? '#f97316' : 'var(--text-muted)' }}>
                    {r.net_change > 0 ? '+' : ''}{r.net_change.toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg)' }}>
                <td colSpan={3} style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL ({filtered.length} produk)</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--green)' }}>
                  {totals.total_in > 0 ? `+${totals.total_in.toLocaleString('id-ID')}` : '-'}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#f97316' }}>
                  {totals.total_out < 0 ? totals.total_out.toLocaleString('id-ID') : '-'}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#8b5cf6' }}>
                  {totals.total_adjust !== 0 ? (totals.total_adjust > 0 ? '+' : '') + totals.total_adjust.toLocaleString('id-ID') : '-'}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: totals.net_change > 0 ? 'var(--green)' : totals.net_change < 0 ? '#f97316' : 'var(--text-muted)' }}>
                  {totals.net_change > 0 ? '+' : ''}{totals.net_change.toLocaleString('id-ID')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ============================================================
// MOVEMENT LOG TAB
// ============================================================
function LedgerTab({ data, typeFilter, setTypeFilter, search, setSearch }: {
  data: any[]; typeFilter: string; setTypeFilter: (v: string) => void;
  search: string; setSearch: (v: string) => void;
}) {
  const filtered = useMemo(() => {
    let result = data;
    if (typeFilter !== 'all') {
      result = result.filter(r => r.movement_type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        (r.reference_id || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        (r.warehouse_products?.name || '').toLowerCase().includes(q) ||
        (r.profiles?.full_name || '').toLowerCase().includes(q) ||
        (r.profiles?.email || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [data, typeFilter, search]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => {
      counts[r.movement_type] = (counts[r.movement_type] || 0) + 1;
    });
    return counts;
  }, [data]);

  return (
    <>
      {/* Search + Type filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Cari order ID, produk, user, catatan..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 12, outline: 'none', minWidth: 260 }} />
        <button
          onClick={() => setTypeFilter('all')}
          style={{
            padding: '4px 12px', borderRadius: 6, border: `1px solid ${typeFilter === 'all' ? 'var(--accent)' : 'var(--border)'}`,
            background: typeFilter === 'all' ? 'var(--accent)' : 'transparent',
            color: typeFilter === 'all' ? '#fff' : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600,
          }}
        >
          Semua ({data.length})
        </button>
        {Object.entries(MOVEMENT_LABELS).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setTypeFilter(typeFilter === key ? 'all' : key)}
            style={{
              padding: '4px 12px', borderRadius: 6, border: `1px solid ${typeFilter === key ? cfg.color : 'var(--border)'}`,
              background: typeFilter === key ? `${cfg.color}20` : 'transparent',
              color: typeFilter === key ? cfg.color : 'var(--dim)', fontSize: 11, cursor: 'pointer', fontWeight: 600,
            }}
          >
            {cfg.label} ({typeCounts[key] || 0})
          </button>
        ))}
        {search && <span style={{ fontSize: 11, color: 'var(--dim)' }}>{filtered.length} hasil</span>}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Waktu', 'Produk', 'Tipe', 'Qty', 'Saldo', 'Batch', 'Referensi', 'Oleh', 'Catatan'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: ['Produk', 'Tipe', 'Batch', 'Referensi', 'Catatan'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const moveCfg = MOVEMENT_LABELS[r.movement_type] || { label: r.movement_type, color: 'var(--text)' };
              const qty = Number(r.quantity);
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {fmtDateTime(r.created_at)}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {r.warehouse_products?.name || '-'}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: `${moveCfg.color}20`, color: moveCfg.color }}>
                      {moveCfg.label}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: qty > 0 ? 'var(--green)' : qty < 0 ? '#f97316' : 'var(--text-muted)' }}>
                    {qty > 0 ? '+' : ''}{qty.toLocaleString('id-ID')}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>
                    {Number(r.running_balance).toLocaleString('id-ID')}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11 }}>
                    {r.warehouse_batches?.batch_code || '-'}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {r.reference_type ? `${r.reference_type}${r.reference_id ? ` #${r.reference_id}` : ''}` : '-'}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {r.profiles?.full_name || r.profiles?.email || (r.created_by ? '...' : 'System')}
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.notes || '-'}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                {search ? `Tidak ditemukan hasil untuk "${search}"` : 'Belum ada movement tercatat'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// BATCH & EXPIRY TAB (NEW)
// ============================================================

function BatchTab({ data, searchQuery, setSearchQuery }: {
  data: any[]; searchQuery: string; setSearchQuery: (v: string) => void;
}) {
  const filtered = useMemo(() => {
    if (!searchQuery) return data;
    const q = searchQuery.toLowerCase();
    return data.filter(r => r.product_name?.toLowerCase().includes(q) || r.batch_code?.toLowerCase().includes(q));
  }, [data, searchQuery]);

  const statusConfig: Record<string, { bg: string; color: string; label: string }> = {
    expired: { bg: 'var(--badge-red-bg)', color: '#fca5a5', label: 'Expired' },
    critical: { bg: 'var(--badge-yellow-bg)', color: '#fcd34d', label: 'Critical' },
    warning: { bg: '#713f12', color: '#fde68a', label: 'Warning' },
    safe: { bg: 'var(--badge-green-bg)', color: '#6ee7b7', label: 'Aman' },
    no_expiry: { bg: 'var(--bg-deep)', color: 'var(--text-secondary)', label: 'No Expiry' },
  };

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { expired: 0, critical: 0, warning: 0, safe: 0, no_expiry: 0 };
    data.forEach(r => { counts[r.expiry_status] = (counts[r.expiry_status] || 0) + 1; });
    return counts;
  }, [data]);

  return (
    <>
      {/* Status overview */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(statusConfig).map(([key, cfg]) => (
          <KPICard key={key} label={cfg.label} value={String(statusCounts[key] || 0)} color={cfg.color} />
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Cari produk atau batch..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%', maxWidth: 400,
          }}
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Produk', 'Kategori', 'Batch', 'Qty', 'Expired Date', 'Sisa Hari', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: ['Produk', 'Kategori', 'Batch', 'Status'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const cfg = statusConfig[r.expiry_status] || statusConfig.safe;
              return (
                <tr key={r.batch_id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{r.product_name}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: CATEGORY_COLORS[r.category] ? `${CATEGORY_COLORS[r.category]}20` : 'var(--bg-deep)', color: CATEGORY_COLORS[r.category] || 'var(--text-secondary)' }}>{r.category}</span>
                  </td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11 }}>{r.batch_code}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text)' }}>
                    {Number(r.current_qty).toLocaleString('id-ID')}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>
                    {r.expired_date ? fullDateID(r.expired_date) : '-'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: cfg.color }}>
                    {r.days_remaining != null ? r.days_remaining : '-'}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada batch tercatat. Buat batch dan catat stock IN untuk melihat data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// RINGKASAN TAB (LEGACY)
// ============================================================

function RingkasanTab({ data, categories, categoryFilter, setCategoryFilter }: {
  data: StockSummary[]; categories: string[];
  categoryFilter: string; setCategoryFilter: (v: string) => void;
}) {
  const totalValue = data.reduce((s, r) => s + r.sub_total_value, 0);
  const totalIn = data.reduce((s, r) => s + r.total_in, 0);
  const totalOut = data.reduce((s, r) => s + r.total_out, 0);
  const productCount = data.length;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total Nilai Stock" value={fmtRupiah(totalValue)} color="var(--accent)" />
        <KPICard label="Jumlah Produk" value={String(productCount)} color="#8b5cf6" />
        <KPICard label="Total Masuk" value={fmtCompact(totalIn)} color="var(--green)" />
        <KPICard label="Total Keluar" value={fmtCompact(totalOut)} color="#f97316" />
      </div>

      <div style={{ marginBottom: 12 }}>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="all">Semua Kategori</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['No', 'Produk', 'Kategori', 'First Day', 'IN', 'OUT', 'Last Day', 'Expired', 'Harga', 'Nilai'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Produk' || h === 'Kategori' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{i + 1}</td>
                <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{r.product_name}</td>
                <td style={{ padding: '6px 10px' }}>
                  <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}>{r.category}</span>
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{r.first_day_stock.toLocaleString('id-ID')}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--green)' }}>{r.total_in.toLocaleString('id-ID')}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#f97316' }}>{r.total_out.toLocaleString('id-ID')}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)', fontWeight: 600 }}>{r.last_day_stock.toLocaleString('id-ID')}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 11 }}>{r.expired_date ? shortDateID(r.expired_date) : '-'}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{fmtRupiah(r.price_list)}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{fmtRupiah(r.sub_total_value)}</td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada data untuk periode ini</td></tr>
            )}
          </tbody>
          {data.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={3} style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--text)' }}>Total</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{data.reduce((s, r) => s + r.first_day_stock, 0).toLocaleString('id-ID')}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--green)' }}>{totalIn.toLocaleString('id-ID')}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#f97316' }}>{totalOut.toLocaleString('id-ID')}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{data.reduce((s, r) => s + r.last_day_stock, 0).toLocaleString('id-ID')}</td>
                <td /><td />
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{fmtRupiah(totalValue)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

// ============================================================
// HARIAN TAB (LEGACY)
// ============================================================

function HarianTab({ data, chartData, categories, categoryFilter, setCategoryFilter }: {
  data: DailyStock[]; chartData: { date: string; in: number; out: number }[];
  categories: string[]; categoryFilter: string; setCategoryFilter: (v: string) => void;
}) {
  const totalIn = data.reduce((s, r) => s + r.stock_in, 0);
  const totalOut = data.reduce((s, r) => s + r.stock_out, 0);
  const netChange = totalIn - totalOut;

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total Masuk (Bulan)" value={fmtCompact(totalIn)} color="var(--green)" />
        <KPICard label="Total Keluar (Bulan)" value={fmtCompact(totalOut)} color="#f97316" />
        <KPICard label="Net Change" value={(netChange >= 0 ? '+' : '') + fmtCompact(netChange)} color={netChange >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}>
          <option value="all">Semua Kategori</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {chartData.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Pergerakan Stock Harian</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="date" tickFormatter={(d) => shortDateID(d)} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1a2744' }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1a2744' }} tickFormatter={(v) => fmtCompact(v)} />
              <Tooltip contentStyle={{ background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelFormatter={(d) => fullDateID(d)} formatter={(v: number, name: string) => [v.toLocaleString('id-ID'), name === 'in' ? 'Masuk' : 'Keluar']} />
              <Legend formatter={(v) => v === 'in' ? 'Masuk' : 'Keluar'} />
              <Bar dataKey="in" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="out" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Tanggal', 'Produk', 'Kategori', 'Masuk (IN)', 'Keluar (OUT)'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: ['Produk', 'Kategori', 'Tanggal'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                <td style={{ padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11 }}>{shortDateID(r.date)}</td>
                <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{r.product_name}</td>
                <td style={{ padding: '6px 10px' }}>
                  <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}>{r.category}</span>
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: r.stock_in > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
                  {r.stock_in > 0 ? r.stock_in.toLocaleString('id-ID') : '-'}
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: r.stock_out > 0 ? '#f97316' : 'var(--text-muted)' }}>
                  {r.stock_out > 0 ? r.stock_out.toLocaleString('id-ID') : '-'}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada data harian untuk periode ini</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// STOCK OPNAME TAB (LEGACY)
// ============================================================

function StockOpnameTab({ soData, soSummary, expandedSO, setExpandedSO }: {
  soData: SORow[]; soSummary: SOSummary[];
  expandedSO: string | null; setExpandedSO: (v: string | null) => void;
}) {
  const totalEvents = soSummary.length;
  const totalItemsWithSelisih = soSummary.reduce((s, r) => s + r.items_with_selisih, 0);
  const totalAbsSelisih = soSummary.reduce((s, r) => s + r.total_abs_selisih, 0);

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total SO Events" value={String(totalEvents)} color="var(--accent)" />
        <KPICard label="Item dengan Selisih" value={String(totalItemsWithSelisih)} color="var(--yellow)" />
        <KPICard label="Total |Selisih|" value={fmtCompact(totalAbsSelisih)} color="var(--red)" />
      </div>

      {soSummary.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>Belum ada data stock opname</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {soSummary.map(so => {
            const key = `${so.opname_date}|${so.opname_label}`;
            const isExpanded = expandedSO === key;
            const details = soData.filter(r => r.opname_date === so.opname_date && r.opname_label === so.opname_label);
            const hasSelisih = so.items_with_selisih > 0;

            return (
              <div key={key} style={{ background: 'var(--card)', border: `1px solid ${hasSelisih ? '#92400e' : 'var(--border)'}`, borderRadius: 12, overflow: 'hidden' }}>
                <button onClick={() => setExpandedSO(isExpanded ? null : key)}
                  style={{ width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer', background: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>{so.opname_label}</span>
                    <span style={{ color: 'var(--dim)', fontSize: 11 }}>{fullDateID(so.opname_date)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{so.item_count} item</span>
                    {hasSelisih && (
                      <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--badge-red-bg)', color: '#fca5a5' }}>{so.items_with_selisih} selisih</span>
                    )}
                    <span style={{ color: 'var(--dim)', fontSize: 14, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>&#9660;</span>
                  </div>
                </button>

                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '0 16px 12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Produk', 'Kategori', 'Sebelum SO', 'Sesudah SO', 'Selisih'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: ['Produk', 'Kategori'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {details.map(d => (
                          <tr key={d.id} style={{ borderBottom: '1px solid var(--bg-deep)', background: d.selisih !== 0 ? 'var(--red-subtle)' : 'transparent' }}>
                            <td style={{ padding: '5px 8px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{d.product_name}</td>
                            <td style={{ padding: '5px 8px' }}>
                              <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}>{d.category}</span>
                            </td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{d.sebelum_so.toLocaleString('id-ID')}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{d.sesudah_so.toLocaleString('id-ID')}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: d.selisih > 0 ? 'var(--green)' : d.selisih < 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                              {d.selisih > 0 ? '+' : ''}{d.selisih.toLocaleString('id-ID')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ============================================================
// EXPIRED MONITOR TAB (LEGACY)
// ============================================================

function ExpiredTab({ data, expiryFilter, setExpiryFilter, allData }: {
  data: ExpiringProduct[]; expiryFilter: string; setExpiryFilter: (v: string) => void; allData: ExpiringProduct[];
}) {
  const statusCounts = useMemo(() => {
    const counts = { expired: 0, critical: 0, warning: 0, safe: 0 };
    allData.forEach(r => {
      if (counts[r.expiry_status as keyof typeof counts] !== undefined) {
        counts[r.expiry_status as keyof typeof counts]++;
      }
    });
    return counts;
  }, [allData]);

  const statusConfig: Record<string, { bg: string; color: string; label: string; border: string }> = {
    expired: { bg: 'var(--badge-red-bg)', color: '#fca5a5', label: 'Expired', border: '#991b1b' },
    critical: { bg: 'var(--badge-yellow-bg)', color: '#fcd34d', label: 'Critical (<30 hari)', border: '#92400e' },
    warning: { bg: '#713f12', color: '#fde68a', label: 'Warning (<90 hari)', border: '#854d0e' },
    safe: { bg: 'var(--badge-green-bg)', color: '#6ee7b7', label: 'Aman', border: '#065f46' },
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(statusConfig).map(([key, cfg]) => (
          <button key={key} onClick={() => setExpiryFilter(expiryFilter === key ? 'all' : key)}
            style={{
              background: 'var(--card)', border: `1px solid ${expiryFilter === key ? cfg.border : 'var(--border)'}`,
              borderRadius: 12, padding: 16, flex: 1, minWidth: 130, cursor: 'pointer',
              borderTop: `3px solid ${cfg.color}`,
              opacity: expiryFilter !== 'all' && expiryFilter !== key ? 0.5 : 1, transition: 'opacity 0.2s',
            }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', textAlign: 'left' }}>{cfg.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: cfg.color, fontFamily: 'monospace', textAlign: 'left' }}>{statusCounts[key as keyof typeof statusCounts]}</div>
          </button>
        ))}
      </div>

      {expiryFilter !== 'all' && (
        <button onClick={() => setExpiryFilter('all')}
          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer', marginBottom: 12, fontWeight: 600 }}>
          Reset Filter
        </button>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Produk', 'Kategori', 'Expired Date', 'Sisa Hari', 'Stok', 'Nilai', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: ['Produk', 'Kategori', 'Status'].includes(h) ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => {
              const cfg = statusConfig[r.expiry_status] || statusConfig.safe;
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                  <td style={{ padding: '6px 10px', color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap' }}>{r.product_name}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'var(--bg-deep)', color: 'var(--text-secondary)' }}>{r.category}</span>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{fullDateID(r.expired_date)}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: cfg.color }}>{r.days_remaining}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{r.last_day_stock.toLocaleString('id-ID')}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{fmtRupiah(r.sub_total_value)}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada produk dengan status expired yang dipilih</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
