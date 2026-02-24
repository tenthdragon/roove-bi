// @ts-nocheck
// app/dashboard/brand-analysis/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah, fmtPct } from '@/lib/utils';
import { fetchCrossBrandMatrix, fetchMultiBrandStats, fetchBrandJourney, fetchBrandAnalysisRefreshTime, refreshBrandAnalysis } from '@/lib/scalev-actions';

const BRAND_COLORS = {
  'Roove': '#3b82f6',
  'Osgard': '#f59e0b',
  'Purvu': '#ec4899',
  'Pluve': '#8b5cf6',
  'Globite': '#10b981',
  'DrHyun': '#06b6d4',
  'Calmara': '#f97316',
};

export default function BrandAnalysisPage() {
  const [matrix, setMatrix] = useState([]);
  const [stats, setStats] = useState(null); // { segments, distribution, gateway }
  const [journey, setJourney] = useState([]);
  const [refreshTime, setRefreshTime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
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
    } catch (err) {
      console.error('Failed to load brand analysis:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshBrandAnalysis();
      await loadData();
    } catch (err) {
      console.error('Refresh failed:', err);
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%' }} />
      </div>
    );
  }

  const hasData = totalCustomers > 0;

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Brand Analysis</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            Cross-brand behavior — single vs multi-brand customers, brand overlap, dan journey
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 11, color: '#475569' }}>
            Terakhir di-refresh: {refreshTime?.refreshed_at
              ? new Date(refreshTime.refreshed_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—'}
          </div>
          <button onClick={handleRefresh} disabled={refreshing} style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid #1a2744', cursor: refreshing ? 'not-allowed' : 'pointer',
            background: '#0b1121', color: '#64748b', fontSize: 12, fontWeight: 600,
          }}>{refreshing ? '⟳ Refreshing...' : '⟳ Refresh'}</button>
        </div>
      </div>

      {!hasData ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40, background: '#111a2e', borderRadius: 12, border: '1px solid #1a2744' }}>
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
          <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Single vs Multi-Brand Customers</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
              Perbandingan customer yang beli 1 brand vs 2+ brand
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ padding: 16, background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Single-Brand</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#94a3b8', fontFamily: "'JetBrains Mono', monospace" }}>
                  {singleCount.toLocaleString('id-ID')}
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                  {totalCustomers > 0 ? fmtPct((singleCount / totalCustomers) * 100) : '0%'} dari total
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
                  <span style={{ color: '#64748b' }}>AOV: <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{fmtCompact(singleAov)}</span></span>
                  <span style={{ color: '#64748b' }}>Rev: <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{fmtCompact(singleRevenue)}</span></span>
                </div>
              </div>
              <div style={{ padding: 16, background: '#0b1121', border: '1px solid #10b981', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Multi-Brand</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#10b981', fontFamily: "'JetBrains Mono', monospace" }}>
                  {multiCount.toLocaleString('id-ID')}
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                  {totalCustomers > 0 ? fmtPct((multiCount / totalCustomers) * 100) : '0%'} dari total
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11 }}>
                  <span style={{ color: '#64748b' }}>AOV: <span style={{ color: '#10b981', fontFamily: 'monospace' }}>{fmtCompact(multiAov)}</span></span>
                  <span style={{ color: '#64748b' }}>Rev: <span style={{ color: '#10b981', fontFamily: 'monospace' }}>{fmtCompact(multiRevenue)}</span></span>
                </div>
                {singleAov > 0 && multiAov > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#10b981', fontWeight: 600 }}>
                    {(multiAov / singleAov).toFixed(1)}x AOV vs single-brand
                  </div>
                )}
              </div>
            </div>

            {/* Distribution */}
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Distribusi Jumlah Brand per Customer</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(distribution).sort((a, b) => Number(a[0]) - Number(b[0])).map(([count, customers]) => (
                <div key={count} style={{ padding: '8px 14px', background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: Number(count) > 1 ? '#10b981' : '#94a3b8', fontFamily: 'monospace' }}>{customers.toLocaleString('id-ID')}</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{count} brand</div>
                </div>
              ))}
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════ */}
          {/* Section 2: Gateway Brands                          */}
          {/* ═══════════════════════════════════════════════════ */}
          {gatewayBrands.length > 0 && (
            <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Gateway Brand</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
                Brand pertama yang dibeli customer — "pintu masuk" ke ekosistem RTI
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {gatewayBrands.map((g) => {
                  const maxCount = gatewayBrands[0]?.count || 1;
                  const pct = totalCustomers > 0 ? (g.count / totalCustomers) * 100 : 0;
                  return (
                    <div key={g.brand} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 80, fontSize: 12, fontWeight: 600, color: BRAND_COLORS[g.brand] || '#94a3b8' }}>{g.brand}</div>
                      <div style={{ flex: 1, height: 24, background: '#0b1121', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          height: '100%', borderRadius: 4,
                          background: BRAND_COLORS[g.brand] || '#64748b',
                          width: `${(g.count / maxCount) * 100}%`,
                          opacity: 0.7,
                        }} />
                        <span style={{ position: 'absolute', left: 8, top: 4, fontSize: 11, fontWeight: 700, color: '#fff' }}>
                          {g.count.toLocaleString('id-ID')}
                        </span>
                      </div>
                      <div style={{ width: 50, fontSize: 11, color: '#64748b', textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(pct, 0)}</div>
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
            <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20, overflowX: 'auto' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Cross-Brand Matrix</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
                Dari customer Brand X, berapa % yang juga beli Brand Y? Baca per baris.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', borderBottom: '2px solid #1a2744', fontWeight: 600, fontSize: 10 }}>DARI ↓ / KE →</th>
                    {matrixBrands.map(b => (
                      <th key={b} style={{ padding: '8px 6px', textAlign: 'center', borderBottom: '2px solid #1a2744', color: BRAND_COLORS[b] || '#94a3b8', fontWeight: 700, fontSize: 10 }}>{b}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixBrands.map(from => (
                    <tr key={from} style={{ borderBottom: '1px solid #0f172a' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: BRAND_COLORS[from] || '#e2e8f0', fontSize: 12 }}>{from}</td>
                      {matrixBrands.map(to => {
                        if (from === to) return <td key={to} style={{ padding: '8px 6px', textAlign: 'center', color: '#1a2744' }}>—</td>;
                        const cell = matrixLookup[`${from}→${to}`];
                        const pct = cell?.overlap_pct || 0;
                        const intensity = Math.min(pct / 30, 1);
                        return (
                          <td key={to} style={{
                            padding: '8px 6px', textAlign: 'center', fontFamily: 'monospace', fontSize: 11,
                            background: pct > 0 ? `rgba(16,185,129,${intensity * 0.25})` : 'transparent',
                            color: pct > 15 ? '#10b981' : pct > 5 ? '#f59e0b' : pct > 0 ? '#94a3b8' : '#1a2744',
                            fontWeight: pct > 10 ? 700 : 400,
                          }}>
                            {pct > 0 ? `${pct}%` : '—'}
                            {cell?.shared_customers > 0 && (
                              <div style={{ fontSize: 9, color: '#475569', fontWeight: 400 }}>{cell.shared_customers}</div>
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
            <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Brand Journey</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
                Pola transisi: customer beli Brand A dulu, lalu ke Brand B (urutan waktu pembelian pertama per brand)
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {journey.slice(0, 15).map((j, i) => {
                  const maxC = journey[0]?.customer_count || 1;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 60, fontSize: 12, fontWeight: 700, color: BRAND_COLORS[j.from_brand] || '#94a3b8', textAlign: 'right' }}>{j.from_brand}</div>
                      <div style={{ fontSize: 14, color: '#475569' }}>→</div>
                      <div style={{ width: 60, fontSize: 12, fontWeight: 700, color: BRAND_COLORS[j.to_brand] || '#94a3b8' }}>{j.to_brand}</div>
                      <div style={{ flex: 1, height: 22, background: '#0b1121', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          height: '100%', borderRadius: 4,
                          background: `linear-gradient(90deg, ${BRAND_COLORS[j.from_brand] || '#64748b'}, ${BRAND_COLORS[j.to_brand] || '#64748b'})`,
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
    </div>
  );
}
