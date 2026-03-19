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
import { fmtCompact, fmtRupiah } from '@/lib/utils';
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
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'harian', label: 'Harian' },
  { id: 'stock-opname', label: 'Stock Opname' },
  { id: 'expired', label: 'Expired Monitor' },
];

const ID_MONTHS = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// ── Helpers ──

function shortDateID(d: string) {
  const parts = d.split('-');
  return `${parseInt(parts[2])}/${parseInt(parts[1])}`;
}

function fullDateID(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
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
  const [activeTab, setActiveTab] = useState('ringkasan');
  const [loading, setLoading] = useState(true);

  // Period selector
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availablePeriods, setAvailablePeriods] = useState<{ period_month: number; period_year: number }[]>([]);

  // Data
  const [summaryData, setSummaryData] = useState<StockSummary[]>([]);
  const [dailyData, setDailyData] = useState<DailyStock[]>([]);
  const [soData, setSOData] = useState<SORow[]>([]);
  const [soSummary, setSOSummary] = useState<SOSummary[]>([]);
  const [expiringData, setExpiringData] = useState<ExpiringProduct[]>([]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [expandedSO, setExpandedSO] = useState<string | null>(null);

  // Load available periods on mount
  useEffect(() => {
    (async () => {
      try {
        const periods = await getWarehouseAvailablePeriods();
        setAvailablePeriods(periods);
        if (periods.length > 0) {
          setSelectedMonth(periods[0].period_month);
          setSelectedYear(periods[0].period_year);
        }
      } catch (e) {
        console.error('Failed to load periods:', e);
      }
      setLoading(false);
    })();
  }, []);

  // Load data when tab or period changes
  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        if (activeTab === 'ringkasan') {
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
  }, [activeTab, selectedMonth, selectedYear, loading]);

  // Categories for filter
  const categories = useMemo(() => {
    const cats = new Set<string>();
    summaryData.forEach(r => r.category && cats.add(r.category));
    dailyData.forEach(r => r.category && cats.add(r.category));
    return Array.from(cats).sort();
  }, [summaryData, dailyData]);

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

  // ── Category filter component ──
  const CategoryFilter = () => (
    <select
      value={categoryFilter}
      onChange={(e) => setCategoryFilter(e.target.value)}
      style={{
        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
        padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none',
      }}
    >
      <option value="all">Semua Kategori</option>
      {categories.map(c => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Gudang</h2>
        <PeriodSelector />
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
      {activeTab === 'ringkasan' && <RingkasanTab data={filteredSummary} categories={categories} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />}
      {activeTab === 'harian' && <HarianTab data={filteredDaily} chartData={dailyChartData} categories={categories} categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />}
      {activeTab === 'stock-opname' && <StockOpnameTab soData={soData} soSummary={soSummary} expandedSO={expandedSO} setExpandedSO={setExpandedSO} />}
      {activeTab === 'expired' && <ExpiredTab data={filteredExpiring} expiryFilter={expiryFilter} setExpiryFilter={setExpiryFilter} allData={expiringData} />}
    </div>
  );
}

// ============================================================
// RINGKASAN TAB
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
      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total Nilai Stock" value={fmtRupiah(totalValue)} color="var(--accent)" />
        <KPICard label="Jumlah Produk" value={String(productCount)} color="#8b5cf6" />
        <KPICard label="Total Masuk" value={fmtCompact(totalIn)} color="var(--green)" />
        <KPICard label="Total Keluar" value={fmtCompact(totalOut)} color="#f97316" />
      </div>

      {/* Category filter */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none',
          }}
        >
          <option value="all">Semua Kategori</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Summary table */}
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
                <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 11 }}>
                  {r.expired_date ? shortDateID(r.expired_date) : '-'}
                </td>
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
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>
                  {data.reduce((s, r) => s + r.first_day_stock, 0).toLocaleString('id-ID')}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--green)' }}>
                  {totalIn.toLocaleString('id-ID')}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#f97316' }}>
                  {totalOut.toLocaleString('id-ID')}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>
                  {data.reduce((s, r) => s + r.last_day_stock, 0).toLocaleString('id-ID')}
                </td>
                <td />
                <td />
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>
                  {fmtRupiah(totalValue)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

// ============================================================
// HARIAN TAB
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
      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total Masuk (Bulan)" value={fmtCompact(totalIn)} color="var(--green)" />
        <KPICard label="Total Keluar (Bulan)" value={fmtCompact(totalOut)} color="#f97316" />
        <KPICard label="Net Change" value={(netChange >= 0 ? '+' : '') + fmtCompact(netChange)} color={netChange >= 0 ? 'var(--green)' : 'var(--red)'} />
      </div>

      {/* Category filter */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '6px 12px', color: 'var(--text)', fontSize: 13, outline: 'none',
          }}
        >
          <option value="all">Semua Kategori</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Pergerakan Stock Harian</div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="date" tickFormatter={(d) => shortDateID(d)} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1a2744' }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#1a2744' }} tickFormatter={(v) => fmtCompact(v)} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                labelFormatter={(d) => fullDateID(d)}
                formatter={(v: number, name: string) => [v.toLocaleString('id-ID'), name === 'in' ? 'Masuk' : 'Keluar']}
              />
              <Legend formatter={(v) => v === 'in' ? 'Masuk' : 'Keluar'} />
              <Bar dataKey="in" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="out" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Daily detail table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Tanggal', 'Produk', 'Kategori', 'Masuk (IN)', 'Keluar (OUT)'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Produk' || h === 'Kategori' || h === 'Tanggal' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
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
// STOCK OPNAME TAB
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
      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <KPICard label="Total SO Events" value={String(totalEvents)} color="var(--accent)" />
        <KPICard label="Item dengan Selisih" value={String(totalItemsWithSelisih)} color="var(--yellow)" />
        <KPICard label="Total |Selisih|" value={fmtCompact(totalAbsSelisih)} color="var(--red)" />
      </div>

      {/* SO event cards */}
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
                {/* Header */}
                <button
                  onClick={() => setExpandedSO(isExpanded ? null : key)}
                  style={{
                    width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
                    background: 'transparent', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', flexWrap: 'wrap', gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>{so.opname_label}</span>
                    <span style={{ color: 'var(--dim)', fontSize: 11 }}>{fullDateID(so.opname_date)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{so.item_count} item</span>
                    {hasSelisih && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                        background: 'var(--badge-red-bg)', color: '#fca5a5',
                      }}>
                        {so.items_with_selisih} selisih
                      </span>
                    )}
                    <span style={{ color: 'var(--dim)', fontSize: 14, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>
                      &#9660;
                    </span>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '0 16px 12px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Produk', 'Kategori', 'Sebelum SO', 'Sesudah SO', 'Selisih'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: h === 'Produk' || h === 'Kategori' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
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
                            <td style={{
                              padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
                              color: d.selisih > 0 ? 'var(--green)' : d.selisih < 0 ? 'var(--red)' : 'var(--text-muted)',
                            }}>
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
// EXPIRED MONITOR TAB
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
      {/* Status overview cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(statusConfig).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setExpiryFilter(expiryFilter === key ? 'all' : key)}
            style={{
              background: 'var(--card)', border: `1px solid ${expiryFilter === key ? cfg.border : 'var(--border)'}`,
              borderRadius: 12, padding: 16, flex: 1, minWidth: 130, cursor: 'pointer',
              borderTop: `3px solid ${cfg.color}`,
              opacity: expiryFilter !== 'all' && expiryFilter !== key ? 0.5 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', textAlign: 'left' }}>{cfg.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: cfg.color, fontFamily: 'monospace', textAlign: 'left' }}>{statusCounts[key as keyof typeof statusCounts]}</div>
          </button>
        ))}
      </div>

      {/* Reset filter */}
      {expiryFilter !== 'all' && (
        <button
          onClick={() => setExpiryFilter('all')}
          style={{
            padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer',
            marginBottom: 12, fontWeight: 600,
          }}
        >
          Reset Filter
        </button>
      )}

      {/* Products table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Produk', 'Kategori', 'Expired Date', 'Sisa Hari', 'Stok', 'Nilai', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Produk' || h === 'Kategori' || h === 'Status' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
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
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: cfg.color }}>
                    {r.days_remaining}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{r.last_day_stock.toLocaleString('id-ID')}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{fmtRupiah(r.sub_total_value)}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: cfg.bg, color: cfg.color,
                    }}>
                      {cfg.label}
                    </span>
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
