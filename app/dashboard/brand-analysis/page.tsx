// @ts-nocheck
// app/dashboard/brand-analysis/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah, fmtPct } from '@/lib/utils';
import {
  fetchCrossBrandMatrix,
  fetchMultiBrandStats,
  fetchBrandJourney,
  fetchBrandAnalysisRefreshTime,
  refreshBrandAnalysis,
  fetchOwnedBrandBuyerHealth,
} from '@/lib/scalev-actions';
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import { buildBrandColorMap } from '@/lib/utils';
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
} from 'recharts';

export default function BrandAnalysisPage() {
  const [activeView, setActiveView] = useState('buyer-health'); // 'buyer-health' | 'cross-brand'
  const [buyerHealth, setBuyerHealth] = useState(null);
  const [buyerHealthLoading, setBuyerHealthLoading] = useState(true);
  const [buyerHealthError, setBuyerHealthError] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [weeksToShow, setWeeksToShow] = useState(52);
  const [matrix, setMatrix] = useState([]);
  const [stats, setStats] = useState(null);
  const [journey, setJourney] = useState([]);
  const [refreshTime, setRefreshTime] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [crossFilter, setCrossFilter] = useState('all'); // 'all' | 'bundle_only' | 'separate_only' | 'mixed'
  const { activeBrands, loading: activeBrandsLoading, error: activeBrandsError, isActiveBrand } = useActiveBrands();

  useEffect(() => { loadBuyerHealth(); }, []);

  useEffect(() => {
    if (activeView === 'cross-brand' && !stats && !loading) loadData();
  }, [activeView]);

  async function loadBuyerHealth() {
    setBuyerHealthLoading(true);
    try {
      const data = await fetchOwnedBrandBuyerHealth({ weeks: 52 });
      setBuyerHealth(data);
      setBuyerHealthError('');
      return true;
    } catch (err: any) {
      console.error('Failed to load buyer health:', err);
      setBuyerHealthError(err?.message || 'Gagal memuat Buyer Health.');
      return false;
    } finally {
      setBuyerHealthLoading(false);
    }
  }

  async function loadData(options?: { showSpinner?: boolean }) {
    const showSpinner = options?.showSpinner !== false;
    if (showSpinner) setLoading(true);
    try {
      const [m, s, j, rt] = await Promise.all([
        fetchCrossBrandMatrix(),
        fetchMultiBrandStats(),
        fetchBrandJourney(),
        fetchBrandAnalysisRefreshTime(),
      ]);
      setMatrix(m);
      setStats(s);
      setJourney(j);
      setRefreshTime(rt);
      setLoadError('');
      return true;
    } catch (err: any) {
      console.error('Failed to load brand analysis:', err);
      setLoadError(err?.message || 'Gagal memuat Brand Analysis.');
      return false;
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError('');
    try {
      await refreshBrandAnalysis();
      const ok = await loadData({ showSpinner: false });
      if (!ok) {
        setRefreshError('Refresh berhasil dijalankan, tetapi data terbaru gagal dimuat ulang.');
      }
    } catch (err: any) {
      console.error('Refresh failed:', err);
      setRefreshError(err?.message || 'Refresh Brand Analysis gagal dijalankan.');
    } finally {
      setRefreshing(false);
    }
  }

  // ── Derived data from pre-aggregated stats ──
  const singleStats = stats?.segments?.['single'] || { customerCount: 0, totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 };
  const dualStats = stats?.segments?.['dual'] || { customerCount: 0, totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 };
  const multiStats = stats?.segments?.['multi'] || { customerCount: 0, totalOrders: 0, totalRevenue: 0, avgOrderValue: 0 };

  const multiCount = dualStats.customerCount + multiStats.customerCount;
  const multiRevenue = dualStats.totalRevenue + multiStats.totalRevenue;
  const multiOrders = dualStats.totalOrders + multiStats.totalOrders;
  const multiAov = multiOrders > 0 ? multiRevenue / multiOrders : 0;

  const singleCount = singleStats.customerCount;
  const singleRevenue = singleStats.totalRevenue;
  const singleOrders = singleStats.totalOrders;
  const singleAov = singleOrders > 0 ? singleRevenue / singleOrders : 0;

  const totalCustomers = singleCount + multiCount;

  const distribution = stats?.distribution || {};
  const gatewayBrands = (stats?.gateway || []).sort((a, b) => b.count - a.count);
  const crossType = stats?.crossType || {};

  const visibleBuyerHealth = useMemo(() => {
    if (!buyerHealth) return null;
    const summaries = (buyerHealth.summaries || []).filter((summary) => isActiveBrand(summary.brand));
    const visibleBrands = new Set(summaries.map((summary) => summary.brand));
    return {
      ...buyerHealth,
      brands: (buyerHealth.brands || []).filter((brand) => visibleBrands.has(brand)),
      summaries,
      points: (buyerHealth.points || []).filter((point) => visibleBrands.has(point.brand)),
    };
  }, [buyerHealth, activeBrands, activeBrandsError, isActiveBrand]);

  useEffect(() => {
    if (!visibleBuyerHealth?.summaries?.length) return;
    if (!selectedBrand || !visibleBuyerHealth.summaries.some((summary) => summary.brand === selectedBrand)) {
      setSelectedBrand(visibleBuyerHealth.summaries[0].brand);
    }
  }, [visibleBuyerHealth, selectedBrand]);

  // ── Matrix brands & lookup ──
  const matrixBrands = useMemo(() => {
    const brands = new Set();
    for (const row of matrix) { brands.add(row.brand_from); brands.add(row.brand_to); }
    return Array.from(brands).sort();
  }, [matrix]);

  const matrixLookup = useMemo(() => {
    const lookup = {};
    for (const row of matrix) { lookup[`${row.brand_from}→${row.brand_to}`] = row; }
    return lookup;
  }, [matrix]);

  const BRAND_COLORS = useMemo(() => {
    const allBrands = [...matrixBrands];
    (stats?.gateway || []).forEach((g: any) => {
      if (!allBrands.includes(g.brand)) allBrands.push(g.brand);
    });
    return buildBrandColorMap(allBrands);
  }, [matrixBrands, stats]);

  const hasData = totalCustomers > 0;

  // ── Toggle button style helper ──
  const toggleStyle = (active: boolean) => ({
    padding: '5px 12px',
    borderRadius: 6,
    border: active ? '1px solid var(--green)' : '1px solid var(--border)',
    background: active ? 'var(--green-subtle)' : 'var(--bg)',
    color: active ? 'var(--green)' : 'var(--dim)',
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  // ── Filtered multi-brand count based on toggle ──
  const filteredMultiCount = crossFilter === 'all'
    ? multiCount
    : crossFilter === 'mixed'
      ? (crossType.mixed || 0)
      : (crossType[crossFilter] || 0);

  const filterLabel = {
    all: 'Semua',
    bundle_only: 'Bundle Only',
    separate_only: 'Cross-Purchase',
    mixed: 'Mixed',
  };

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Brand Analysis</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--dim)' }}>
            {activeView === 'buyer-health'
              ? 'Owned channel buyer base — trailing active buyer 90D dan new-to-brand customer'
              : 'Cross-brand behavior — single vs multi-brand customers, brand overlap, dan journey'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {activeView === 'buyer-health' ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Week end: {buyerHealth?.coverage?.latestCompletedWeekEnd || '—'}
              </div>
              <button onClick={loadBuyerHealth} disabled={buyerHealthLoading} style={{
                padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: buyerHealthLoading ? 'not-allowed' : 'pointer',
                background: 'var(--bg)', color: 'var(--dim)', fontSize: 12, fontWeight: 600,
              }}>{buyerHealthLoading ? '⟳ Loading...' : '⟳ Reload'}</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Terakhir di-refresh: {refreshTime?.refreshed_at
                  ? new Date(refreshTime.refreshed_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </div>
              <button onClick={handleRefresh} disabled={refreshing} style={{
                padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: refreshing ? 'not-allowed' : 'pointer',
                background: 'var(--bg)', color: 'var(--dim)', fontSize: 12, fontWeight: 600,
              }}>{refreshing ? '⟳ Refreshing...' : '⟳ Refresh'}</button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, background: 'var(--card)', padding: 4, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 18, width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
        {[
          { key: 'buyer-health', label: 'Buyer Health' },
          { key: 'cross-brand', label: 'Cross-Brand' },
        ].map((view) => {
          const active = activeView === view.key;
          return (
            <button
              key={view.key}
              onClick={() => setActiveView(view.key)}
              style={{
                padding: '7px 14px',
                borderRadius: 6,
                border: active ? '1px solid var(--accent)' : '1px solid transparent',
                background: active ? 'rgba(59,130,246,0.16)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--dim)',
                fontSize: 12,
                fontWeight: active ? 700 : 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {view.label}
            </button>
          );
        })}
      </div>

      {activeView === 'buyer-health' ? (
        <BuyerHealthView
          data={visibleBuyerHealth}
          loading={buyerHealthLoading || activeBrandsLoading}
          error={activeBrandsError || buyerHealthError}
          selectedBrand={selectedBrand}
          setSelectedBrand={setSelectedBrand}
          weeksToShow={weeksToShow}
          setWeeksToShow={setWeeksToShow}
        />
      ) : (
        <>
      {refreshError && (
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 12, padding: 14, color: '#fca5a5', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Refresh Brand Analysis Bermasalah</div>
          <div style={{ fontSize: 12 }}>{refreshError}</div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
        </div>
      ) : loadError ? (
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 12, padding: 18, color: '#fca5a5' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Data Brand Analysis Gagal Dimuat</div>
          <div style={{ fontSize: 13 }}>{loadError}</div>
        </div>
      ) : !hasData ? (
        <div style={{ color: 'var(--dim)', textAlign: 'center', padding: 40, background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)' }}>
          Belum ada data brand analysis. Pastikan materialized view sudah di-refresh setelah upload data.
          <div style={{ marginTop: 12 }}>
            <button onClick={handleRefresh} disabled={refreshing} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#1e40af', color: '#93c5fd', fontSize: 13, fontWeight: 600,
            }}>{refreshing ? 'Refreshing...' : '🔄 Refresh Data'}</button>
          </div>
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════ */}
          {/* Section 1: Single vs Multi-Brand                   */}
          {/* ═══════════════════════════════════════════════════ */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Single vs Multi-Brand Customers</h3>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>
                  Perbandingan customer yang beli 1 brand vs 2+ brand
                </p>
              </div>
              {/* Toggle */}
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
                {['all', 'bundle_only', 'separate_only', 'mixed'].map(f => (
                  <button key={f} onClick={() => setCrossFilter(f)} style={toggleStyle(crossFilter === f)}>
                    {filterLabel[f]}
                    {f !== 'all' && crossType[f] > 0 && (
                      <span style={{ marginLeft: 4, opacity: 0.7 }}>({crossType[f]})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ padding: 16, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Single-Brand</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {singleCount.toLocaleString('id-ID')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {totalCustomers > 0 ? fmtPct((singleCount / totalCustomers) * 100) : '0%'} dari total
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
                  <span style={{ color: 'var(--dim)' }}>AOV: <span style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{fmtCompact(singleAov)}</span></span>
                  <span style={{ color: 'var(--dim)' }}>Rev: <span style={{ color: 'var(--text)', fontFamily: 'monospace' }}>{fmtCompact(singleRevenue)}</span></span>
                </div>
              </div>
              <div style={{ padding: 16, background: 'var(--bg)', border: '1px solid var(--green)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
                  Multi-Brand
                  {crossFilter !== 'all' && (
                    <span style={{ fontWeight: 400, marginLeft: 4, fontSize: 10, color: '#0d9488' }}>
                      ({filterLabel[crossFilter]})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {filteredMultiCount.toLocaleString('id-ID')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {totalCustomers > 0 ? fmtPct((filteredMultiCount / totalCustomers) * 100) : '0%'} dari total
                </div>
                {crossFilter === 'all' && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
                    <span style={{ color: 'var(--dim)' }}>AOV: <span style={{ color: 'var(--green)', fontFamily: 'monospace' }}>{fmtCompact(multiAov)}</span></span>
                    <span style={{ color: 'var(--dim)' }}>Rev: <span style={{ color: 'var(--green)', fontFamily: 'monospace' }}>{fmtCompact(multiRevenue)}</span></span>
                  </div>
                )}
                {crossFilter === 'all' && singleAov > 0 && multiAov > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                    {(multiAov / singleAov).toFixed(1)}x AOV vs single-brand
                  </div>
                )}
                {crossFilter !== 'all' && (
                  <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {crossFilter === 'bundle_only' && 'Customer yang beli multi-brand hanya dari bundling (1 invoice)'}
                    {crossFilter === 'separate_only' && 'Customer yang beli multi-brand di transaksi terpisah (repeat buyer lintas brand)'}
                    {crossFilter === 'mixed' && 'Customer yang beli multi-brand dari bundling DAN transaksi terpisah'}
                  </div>
                )}
              </div>
            </div>

            {/* Cross-type breakdown pills */}
            {crossFilter === 'all' && (crossType.bundle_only > 0 || crossType.separate_only > 0) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ color: 'var(--yellow)', fontWeight: 700 }}>{crossType.bundle_only || 0}</span>
                  <span style={{ color: 'var(--dim)', marginLeft: 4 }}>bundle only</span>
                </div>
                <div style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>{crossType.separate_only || 0}</span>
                  <span style={{ color: 'var(--dim)', marginLeft: 4 }}>cross-purchase</span>
                </div>
                <div style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}>
                  <span style={{ color: '#8b5cf6', fontWeight: 700 }}>{crossType.mixed || 0}</span>
                  <span style={{ color: 'var(--dim)', marginLeft: 4 }}>mixed</span>
                </div>
              </div>
            )}

            {/* Distribution */}
            <div style={{ fontSize: 12, color: 'var(--dim)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Distribusi Jumlah Brand per Customer</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(distribution).sort((a, b) => Number(a[0]) - Number(b[0])).map(([count, customers]) => (
                <div key={count} style={{ padding: '8px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: Number(count) > 1 ? 'var(--green)' : 'var(--text-secondary)', fontFamily: 'monospace' }}>{customers.toLocaleString('id-ID')}</div>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{count} brand</div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* Section 2: Gateway Brands                          */}
          {/* ═══════════════════════════════════════════════════ */}
          {gatewayBrands.length > 0 && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Gateway Brand</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--dim)' }}>
                Brand pertama yang dibeli customer — "pintu masuk" ke ekosistem RTI
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {gatewayBrands.map((g) => {
                  const maxCount = gatewayBrands[0]?.count || 1;
                  const pct = totalCustomers > 0 ? (g.count / totalCustomers) * 100 : 0;
                  return (
                    <div key={g.brand} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 80, fontSize: 12, fontWeight: 600, color: BRAND_COLORS[g.brand] || 'var(--text-secondary)' }}>{g.brand}</div>
                      <div style={{ flex: 1, height: 24, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          height: '100%', borderRadius: 4,
                          background: BRAND_COLORS[g.brand] || 'var(--dim)',
                          width: `${(g.count / maxCount) * 100}%`,
                          opacity: 0.7,
                        }} />
                        <span style={{ position: 'absolute', left: 8, top: 4, fontSize: 11, fontWeight: 700, color: '#fff' }}>
                          {g.count.toLocaleString('id-ID')}
                        </span>
                      </div>
                      <div style={{ width: 50, fontSize: 11, color: 'var(--dim)', textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(pct, 0)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* Section 3: Cross-Brand Matrix                      */}
          {/* ═══════════════════════════════════════════════════ */}
          {matrixBrands.length > 1 && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20, overflowX: 'auto' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Cross-Brand Matrix</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--dim)' }}>
                Dari customer Brand X, berapa % yang juga beli Brand Y? Baca per baris.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--dim)', borderBottom: '2px solid var(--border)', fontWeight: 600, fontSize: 10 }}>DARI ↓ / KE →</th>
                    {matrixBrands.map(b => (
                      <th key={b} style={{ padding: '8px 6px', textAlign: 'center', borderBottom: '2px solid var(--border)', color: BRAND_COLORS[b] || 'var(--text-secondary)', fontWeight: 700, fontSize: 10 }}>{b}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixBrands.map(from => (
                    <tr key={from} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: BRAND_COLORS[from] || 'var(--text)', fontSize: 12 }}>{from}</td>
                      {matrixBrands.map(to => {
                        if (from === to) return <td key={to} style={{ padding: '8px 6px', textAlign: 'center', color: 'var(--border)' }}>—</td>;
                        const cell = matrixLookup[`${from}→${to}`];
                        const pct = cell?.overlap_pct || 0;
                        const intensity = Math.min(pct / 30, 1);
                        return (
                          <td key={to} style={{
                            padding: '8px 6px', textAlign: 'center', fontFamily: 'monospace', fontSize: 11,
                            background: pct > 0 ? `rgba(16,185,129,${intensity * 0.25})` : 'transparent',
                            color: pct > 15 ? 'var(--green)' : pct > 5 ? 'var(--yellow)' : pct > 0 ? 'var(--text-secondary)' : 'var(--border)',
                            fontWeight: pct > 10 ? 700 : 400,
                          }}>
                            {pct > 0 ? `${pct}%` : '—'}
                            {cell?.shared_customers > 0 && (
                              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>{cell.shared_customers}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════ */}
          {/* Section 4: Brand Journey                           */}
          {/* ═══════════════════════════════════════════════════ */}
          {journey.length > 0 && (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Brand Journey</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--dim)' }}>
                Pola transisi: customer beli Brand A dulu, lalu ke Brand B (urutan waktu pembelian pertama per brand)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {journey.slice(0, 15).map((j, i) => {
                  const maxC = journey[0]?.customer_count || 1;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 60, fontSize: 12, fontWeight: 700, color: BRAND_COLORS[j.from_brand] || 'var(--text-secondary)', textAlign: 'right' }}>{j.from_brand}</div>
                      <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>→</div>
                      <div style={{ width: 60, fontSize: 12, fontWeight: 700, color: BRAND_COLORS[j.to_brand] || 'var(--text-secondary)' }}>{j.to_brand}</div>
                      <div style={{ flex: 1, height: 22, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          height: '100%', borderRadius: 4,
                          background: `linear-gradient(90deg, ${BRAND_COLORS[j.from_brand] || 'var(--dim)'}, ${BRAND_COLORS[j.to_brand] || 'var(--dim)'})`,
                          width: `${(j.customer_count / maxC) * 100}%`,
                          opacity: 0.6,
                        }} />
                        <span style={{ position: 'absolute', left: 8, top: 3, fontSize: 11, fontWeight: 700, color: '#fff' }}>
                          {j.customer_count} customers
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
        </>
      )}
    </div>
  );
}

function BuyerHealthView({ data, loading, error, selectedBrand, setSelectedBrand, weeksToShow, setWeeksToShow }) {
  const summaries = data?.summaries || [];
  const brandColors = useMemo(() => buildBrandColorMap(summaries.map((summary) => summary.brand)), [summaries]);
  const selectedSummary = summaries.find((summary) => summary.brand === selectedBrand) || summaries[0] || null;
  const chartPoints = (selectedSummary?.points || []).slice(-weeksToShow).map((point) => ({
    ...point,
    weekLabel: formatWeekLabel(point.weekEnd),
  }));
  const statusMeta = selectedSummary ? BUYER_HEALTH_STATUS_META[selectedSummary.status] : null;
  const latestPoint = selectedSummary?.points?.[selectedSummary.points.length - 1] || null;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 12, padding: 18, color: '#fca5a5' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Buyer Health Gagal Dimuat</div>
        <div style={{ fontSize: 13 }}>{error}</div>
      </div>
    );
  }

  if (!selectedSummary) {
    return (
      <div style={{ color: 'var(--dim)', textAlign: 'center', padding: 40, background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)' }}>
        Belum ada data owned-channel buyer health yang memenuhi kriteria identity phone-backed.
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        <BuyerHealthKpi
          label="Active Base 90D"
          value={selectedSummary.latestActiveBuyers.toLocaleString('id-ID')}
          sub={`${formatSigned(selectedSummary.activeDelta4w)} vs 4 minggu`}
          color={brandColors[selectedSummary.brand] || 'var(--accent)'}
        />
        <BuyerHealthKpi
          label="New Buyer"
          value={selectedSummary.latestNewBuyers.toLocaleString('id-ID')}
          sub={`${formatSigned(selectedSummary.newDelta)} WoW`}
          color="var(--green)"
        />
        <BuyerHealthKpi
          label="Avg New 4W"
          value={Math.round(selectedSummary.recentNewAvg).toLocaleString('id-ID')}
          sub={`${formatSigned(Math.round(selectedSummary.newAvgDelta || 0))} vs prev 4W`}
          color="var(--yellow)"
        />
        <div style={{ padding: 16, background: 'var(--card)', border: `1px solid ${statusMeta?.color || 'var(--border)'}`, borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Status</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: statusMeta?.color || 'var(--text)', lineHeight: 1.2 }}>{statusMeta?.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.45 }}>{statusMeta?.copy}</div>
        </div>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 800 }}>{selectedSummary.brand} Buyer Health</h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>
              Trailing 90D active buyer dan weekly new-to-brand buyer, owned channel only
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 3, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
              {[13, 26, 52].map((weeks) => (
                <button
                  key={weeks}
                  onClick={() => setWeeksToShow(weeks)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: weeksToShow === weeks ? '1px solid var(--accent)' : '1px solid transparent',
                    background: weeksToShow === weeks ? 'rgba(59,130,246,0.16)' : 'transparent',
                    color: weeksToShow === weeks ? 'var(--accent)' : 'var(--dim)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {weeks}W
                </button>
              ))}
            </div>
            <select
              value={selectedSummary.brand}
              onChange={(event) => setSelectedBrand(event.target.value)}
              style={{
                height: 30,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontSize: 12,
                fontWeight: 700,
                padding: '0 10px',
                outline: 'none',
              }}
            >
              {summaries.map((summary) => (
                <option key={summary.brand} value={summary.brand}>{summary.brand}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ width: '100%', height: 360 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartPoints} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="weekLabel" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} minTickGap={18} />
              <YAxis yAxisId="base" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
              <YAxis yAxisId="new" orientation="right" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip content={<BuyerHealthTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--dim)' }} />
              <Bar yAxisId="new" dataKey="newBuyers" name="New Buyer" fill="var(--green)" radius={[3, 3, 0, 0]} opacity={0.76} />
              <Line
                yAxisId="base"
                type="monotone"
                dataKey="trailingActiveBuyers"
                name="Active Base 90D"
                stroke={brandColors[selectedSummary.brand] || 'var(--accent)'}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, color: 'var(--text-muted)', fontSize: 11 }}>
          <span>Latest week: {latestPoint ? formatDateId(latestPoint.weekStart) : '—'} - {latestPoint ? formatDateId(latestPoint.weekEnd) : '—'}</span>
          <span>Rows read: {Number(data?.coverage?.rowsRead || 0).toLocaleString('id-ID')}</span>
          <span>Identity: phone-backed owned channel</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        {summaries.map((summary) => {
          const meta = BUYER_HEALTH_STATUS_META[summary.status];
          const active = summary.brand === selectedSummary.brand;
          return (
            <button
              key={summary.brand}
              onClick={() => setSelectedBrand(summary.brand)}
              style={{
                textAlign: 'left',
                padding: 14,
                background: 'var(--card)',
                border: active ? `1px solid ${brandColors[summary.brand] || 'var(--accent)'}` : '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: brandColors[summary.brand] || 'var(--text)' }}>{summary.brand}</div>
                <div style={{ fontSize: 10, color: meta.color, fontWeight: 800, textTransform: 'uppercase' }}>{meta.label}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase' }}>Base 90D</div>
                  <div style={{ fontSize: 18, color: 'var(--text)', fontFamily: 'monospace', fontWeight: 800 }}>{summary.latestActiveBuyers.toLocaleString('id-ID')}</div>
                  <div style={{ fontSize: 10, color: deltaColor(summary.activeDelta4w) }}>{formatSigned(summary.activeDelta4w)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase' }}>New</div>
                  <div style={{ fontSize: 18, color: 'var(--green)', fontFamily: 'monospace', fontWeight: 800 }}>{summary.latestNewBuyers.toLocaleString('id-ID')}</div>
                  <div style={{ fontSize: 10, color: deltaColor(summary.newDelta) }}>{formatSigned(summary.newDelta)} WoW</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function BuyerHealthKpi({ label, value, sub, color }) {
  return (
    <div style={{ padding: 16, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: 11, color: sub?.startsWith('+') ? 'var(--green)' : sub?.startsWith('-') ? 'var(--red)' : 'var(--text-muted)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function BuyerHealthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.18)' }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Week end: {formatDateId(row.weekEnd)}</div>
      <div style={{ fontSize: 12, color: 'var(--text)' }}>Active Base 90D: <strong>{Number(row.trailingActiveBuyers || 0).toLocaleString('id-ID')}</strong></div>
      <div style={{ fontSize: 12, color: 'var(--green)' }}>New Buyer: <strong>{Number(row.newBuyers || 0).toLocaleString('id-ID')}</strong></div>
    </div>
  );
}

const BUYER_HEALTH_STATUS_META = {
  healthy_growth: {
    label: 'Healthy Growth',
    color: 'var(--green)',
    copy: 'Base naik dan new buyer ikut naik.',
  },
  retention_led: {
    label: 'Retention-Led',
    color: 'var(--yellow)',
    copy: 'Base naik, tapi akuisisi tidak ikut menguat.',
  },
  acquisition_treadmill: {
    label: 'Treadmill',
    color: '#f97316',
    copy: 'New buyer masuk, tapi base belum bertambah.',
  },
  contraction: {
    label: 'Contraction',
    color: 'var(--red)',
    copy: 'Base dan new buyer sama-sama melemah.',
  },
  leaky_base: {
    label: 'Leaky Base',
    color: 'var(--red)',
    copy: 'Akuisisi belum cukup menahan buyer keluar dari window.',
  },
  stable_low_acquisition: {
    label: 'Stable',
    color: 'var(--dim)',
    copy: 'Base relatif datar dan akuisisi rendah.',
  },
};

function formatSigned(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const rounded = Math.round(Number(value));
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('id-ID')}`;
}

function deltaColor(value) {
  if (value == null || Number(value) === 0) return 'var(--text-muted)';
  return Number(value) > 0 ? 'var(--green)' : 'var(--red)';
}

function formatDateId(dateKey) {
  if (!dateKey) return '—';
  return new Date(`${dateKey}T00:00:00+07:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatWeekLabel(dateKey) {
  if (!dateKey) return '—';
  return new Date(`${dateKey}T00:00:00+07:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
  });
}
