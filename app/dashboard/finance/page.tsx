// app/dashboard/finance/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  getFinancialPLSummary,
  getFinancialCFSummary,
  getFinancialRatios,
} from '@/lib/financial-actions';

// ============================================================
// TYPES
// ============================================================

interface PLSummary {
  month: string;
  penjualan: number; diskon_penjualan: number; penjualan_bersih: number;
  cogs: number; laba_bruto: number; total_beban: number;
  beban_iklan: number; beban_mp: number; beban_pengiriman: number;
  beban_penjualan: number; beban_operasional: number;
  pendapatan_lainnya: number; laba_rugi: number;
}

interface CFSummary {
  month: string;
  penerimaan_pelanggan: number; penerimaan_reseller: number;
  cf_operasi: number; cf_investasi: number; cf_pendanaan: number;
  net_cash_change: number; saldo_kas_awal: number; saldo_kas_akhir: number;
  free_cash_flow: number;
}

interface RatioData {
  month: string; ratio_name: string; ratio_label: string;
  category: string; value: number;
  benchmark_min: number | null; benchmark_max: number | null;
  benchmark_label: string | null;
}

interface AIAnalysis {
  health_score?: number;
  health_label?: string;
  unspoken_truth?: string;
  strategic_advice?: {
    stop_immediately?: string[];
    start_this_month?: string[];
    big_decision_this_quarter?: string;
    if_only_one_brand?: string;
  };
  cash_analysis?: any;
  revenue_quality?: any;
  cost_alerts?: any[];
  hidden_patterns?: any[];
  strategic_risks?: any[];
  competitive_survival?: any;
  key_ratios_alert?: any[];
  // Legacy fields (backward compat with old saved analyses)
  cash_proxy_analysis?: any;
}

// ============================================================
// HELPERS
// ============================================================

function fmtB(n: number | null): string {
  if (!n && n !== 0) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}Rp ${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}Rp ${(abs / 1e3).toFixed(0)}K`;
  return `${sign}Rp ${abs.toFixed(0)}`;
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return '-';
  return `${(n * 100).toFixed(1)}%`;
}

function monthLabel(m: string): string {
  const d = new Date(m + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

function ratioStatus(value: number, min: number | null, max: number | null): string {
  if (min === null || max === null) return 'healthy';
  if (value >= min && value <= max) return 'healthy';
  if (value < min * 0.5 || value > max * 2) return 'critical';
  return 'warning';
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Shared table styles
const S = {
  scrollArea: { overflowX: 'auto' as const, WebkitOverflowScrolling: 'touch' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13, minWidth: 900 },
  thSticky: {
    position: 'sticky' as const, left: 0, zIndex: 2,
    background: '#1f2937', padding: '8px 12px', textAlign: 'left' as const,
    color: '#9ca3af', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' as const,
    borderBottom: '1px solid #374151', minWidth: 190,
  },
  th: {
    padding: '8px 10px', textAlign: 'right' as const,
    color: '#9ca3af', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' as const,
    borderBottom: '1px solid #374151', minWidth: 105,
  },
  tdSticky: (bold: boolean) => ({
    position: 'sticky' as const, left: 0, zIndex: 1,
    background: '#1f2937', padding: '6px 12px',
    color: bold ? '#f3f4f6' : '#d1d5db', fontWeight: bold ? 600 : 400,
    whiteSpace: 'nowrap' as const, borderBottom: '1px solid rgba(55,65,81,0.4)', minWidth: 190,
  }),
  td: (negative: boolean) => ({
    padding: '6px 10px', textAlign: 'right' as const,
    color: negative ? '#f87171' : '#e5e7eb',
    borderBottom: '1px solid rgba(55,65,81,0.4)', whiteSpace: 'nowrap' as const, minWidth: 105,
  }),
  tdItalicSticky: {
    position: 'sticky' as const, left: 0, zIndex: 1,
    background: '#1f2937', padding: '6px 12px',
    color: '#9ca3af', fontStyle: 'italic' as const, whiteSpace: 'nowrap' as const,
    borderTop: '1px solid #4b5563', minWidth: 190,
  },
  tdItalic: (negative: boolean) => ({
    padding: '6px 10px', textAlign: 'right' as const,
    color: negative ? '#f87171' : '#9ca3af', fontStyle: 'italic' as const,
    borderTop: '1px solid #4b5563', whiteSpace: 'nowrap' as const, minWidth: 105,
  }),
};

// ============================================================
// KPI CARD
// ============================================================

function KPICard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: 16, border: '1px solid #374151' }}>
      <p style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: color || '#fff' }}>{value}</p>
      {sub && <p style={{ fontSize: 11, marginTop: 4, color: '#6b7280' }}>{sub}</p>}
    </div>
  );
}

// ============================================================
// PL TABLE
// ============================================================

function PLTable({ data }: { data: PLSummary[] }) {
  if (!data.length) return null;
  const rows = [
    { key: 'penjualan', label: 'Penjualan (Gross)', bold: false },
    { key: 'diskon_penjualan', label: 'Diskon Penjualan', bold: false },
    { key: 'penjualan_bersih', label: 'Penjualan Bersih', bold: true },
    { key: 'cogs', label: 'COGS', bold: false },
    { key: 'laba_bruto', label: 'Laba Bruto', bold: true },
    { key: 'beban_iklan', label: '  Beban Iklan & Promosi', bold: false },
    { key: 'beban_mp', label: '  Beban Admin MP', bold: false },
    { key: 'beban_pengiriman', label: '  Beban Pengiriman', bold: false },
    { key: 'beban_penjualan', label: 'Total Beban Penjualan', bold: true },
    { key: 'beban_operasional', label: 'Total Beban Operasional', bold: true },
    { key: 'pendapatan_lainnya', label: 'Pendapatan Lain-lain', bold: false },
    { key: 'laba_rugi', label: 'Laba / (Rugi) Bersih', bold: true },
  ];
  return (
    <div style={{ background: '#1f2937', borderRadius: 8, border: '1px solid #374151', padding: '16px 0' }}>
      <h3 style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: '0 0 12px 16px' }}>📋 Profit & Loss — Delivered Basis</h3>
      <div style={S.scrollArea}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.thSticky}>Item</th>
            {data.map(r => <th key={r.month} style={S.th}>{monthLabel(r.month)}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(item => (
              <tr key={item.key}>
                <td style={S.tdSticky(item.bold)}>{item.label}</td>
                {data.map(r => {
                  const val = (r as any)[item.key] as number;
                  return <td key={r.month} style={S.td(val < 0)}>{fmtB(val)}</td>;
                })}
              </tr>
            ))}
            <tr>
              <td style={S.tdItalicSticky}>GPM</td>
              {data.map(r => <td key={r.month} style={S.tdItalic(false)}>{r.penjualan_bersih ? fmtPct(r.laba_bruto / r.penjualan_bersih) : '-'}</td>)}
            </tr>
            <tr>
              <td style={{ ...S.tdItalicSticky, borderTop: 'none' }}>NPM</td>
              {data.map(r => <td key={r.month} style={{ ...S.tdItalic(r.laba_rugi < 0), borderTop: 'none' }}>{r.penjualan_bersih ? fmtPct(r.laba_rugi / r.penjualan_bersih) : '-'}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// CF TABLE
// ============================================================

function CFTable({ data }: { data: CFSummary[] }) {
  if (!data.length) return null;
  const rows = [
    { key: 'penerimaan_pelanggan', label: 'Penerimaan Pelanggan', bold: false },
    { key: 'penerimaan_reseller', label: 'Penerimaan Reseller', bold: false },
    { key: 'cf_operasi', label: 'CF Operasi', bold: true },
    { key: 'cf_investasi', label: 'CF Investasi', bold: false },
    { key: 'cf_pendanaan', label: 'CF Pendanaan', bold: false },
    { key: 'net_cash_change', label: 'Net Cash Change', bold: true },
    { key: 'saldo_kas_akhir', label: 'Saldo Kas Akhir', bold: true },
    { key: 'free_cash_flow', label: 'Free Cash Flow', bold: true },
  ];
  return (
    <div style={{ background: '#1f2937', borderRadius: 8, border: '1px solid #374151', padding: '16px 0' }}>
      <h3 style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: '0 0 12px 16px' }}>💰 Cash Flow</h3>
      <div style={S.scrollArea}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.thSticky}>Item</th>
            {data.map(r => <th key={r.month} style={S.th}>{monthLabel(r.month)}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(item => (
              <tr key={item.key}>
                <td style={S.tdSticky(item.bold)}>{item.label}</td>
                {data.map(r => {
                  const val = (r as any)[item.key] as number;
                  return <td key={r.month} style={S.td(val < 0)}>{fmtB(val)}</td>;
                })}
              </tr>
            ))}
            <tr>
              <td style={S.tdItalicSticky}>Cash Efficiency</td>
              {data.map(r => {
                const totalIn = (r.penerimaan_pelanggan || 0) + (r.penerimaan_reseller || 0);
                const eff = totalIn > 0 ? (r.cf_operasi || 0) / totalIn : null;
                return <td key={r.month} style={S.tdItalic(eff !== null && eff < 0)}>{eff !== null ? fmtPct(eff) : '-'}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// RATIOS TABLE
// ============================================================

function RatiosTable({ data }: { data: RatioData[] }) {
  if (!data.length) return null;
  const months = [...new Set(data.map(d => d.month))].sort().reverse();
  const ratioNames = [...new Set(data.map(d => d.ratio_name))];
  const niceLabel: Record<string, string> = {
    gpm: 'Gross Profit Margin', npm: 'Net Profit Margin',
    roa: 'Return on Assets', roe: 'Return on Equity',
    cash_ratio: 'Cash Ratio', current_ratio: 'Current Ratio',
    quick_ratio: 'Quick Ratio', debt_ratio: 'Debt Ratio',
    ccr: 'Cash Conversion Ratio', ocf_to_asset: 'OCF to Asset',
    asset_turnover: 'Asset Turnover', inventory_turnover: 'Inventory Turnover',
  };
  const statusColor: Record<string, string> = { healthy: '#34d399', warning: '#fbbf24', critical: '#f87171' };
  return (
    <div style={{ background: '#1f2937', borderRadius: 8, border: '1px solid #374151', padding: '16px 0' }}>
      <h3 style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: '0 0 12px 16px' }}>📊 Rasio Keuangan vs Benchmark</h3>
      <div style={S.scrollArea}>
        <table style={S.table}>
          <thead><tr>
            <th style={{ ...S.thSticky, minWidth: 170 }}>Rasio</th>
            <th style={{ ...S.th, textAlign: 'center', minWidth: 90 }}>Benchmark</th>
            {months.map(m => <th key={m} style={{ ...S.th, minWidth: 80 }}>{monthLabel(m)}</th>)}
          </tr></thead>
          <tbody>
            {ratioNames.map(rn => {
              const items = data.filter(d => d.ratio_name === rn);
              const bMin = items[0]?.benchmark_min; const bMax = items[0]?.benchmark_max;
              return (
                <tr key={rn}>
                  <td style={{ ...S.tdSticky(false), minWidth: 170 }}>{niceLabel[rn] || rn}</td>
                  <td style={{ ...S.td(false), textAlign: 'center', color: '#6b7280', fontSize: 11 }}>{items[0]?.benchmark_label || '-'}</td>
                  {months.map(m => {
                    const item = items.find(i => i.month === m);
                    if (!item) return <td key={m} style={{ ...S.td(false), color: '#4b5563' }}>-</td>;
                    const status = ratioStatus(item.value, bMin ?? null, bMax ?? null);
                    const isPercent = ['gpm', 'npm', 'roa', 'roe', 'ocf_to_asset'].includes(rn);
                    return <td key={m} style={{ ...S.td(false), color: statusColor[status] }}>{isPercent ? fmtPct(item.value) : item.value.toFixed(2)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: '#6b7280', margin: '8px 16px 0' }}>
        <span style={{ color: '#34d399' }}>●</span> Dalam benchmark &nbsp;<span style={{ color: '#fbbf24' }}>●</span> Di luar &nbsp;<span style={{ color: '#f87171' }}>●</span> Jauh di luar
      </p>
    </div>
  );
}

// ============================================================
// AI ANALYSIS PANEL — Opus 4.6 Strategic Advisory
// ============================================================

function AIPanel({ pl, cf, ratios, userId }: { pl: PLSummary[]; cf: CFSummary[]; ratios: RatioData[]; userId?: string }) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [analysisTime, setAnalysisTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPrev, setLoadingPrev] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { loadSavedAnalysis(); }, []);

  async function loadSavedAnalysis() {
    setLoadingPrev(true);
    try {
      const { createClient } = await import('@/lib/supabase-browser');
      const supabase = createClient();
      const { data } = await supabase.from('financial_analyses')
        .select('analysis_data, created_at').eq('analysis_type', 'executive')
        .order('created_at', { ascending: false }).limit(1).single();
      if (data) { setAnalysis(data.analysis_data as AIAnalysis); setAnalysisTime(data.created_at); }
    } catch (e: any) { /* No saved */ }
    setLoadingPrev(false);
  }

  async function generate() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/financial-analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'executive', numMonths: 12 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const parsed = JSON.parse(data.analysis);
      setAnalysis(parsed); setAnalysisTime(new Date().toISOString());
      try {
        const { createClient } = await import('@/lib/supabase-browser');
        const supabase = createClient();
        await supabase.from('financial_analyses').insert({
          analysis_type: 'executive', analysis_data: parsed,
          health_score: parsed.health_score || null, generated_by: userId || null,
        });
      } catch (e) { console.error('Save failed:', e); }
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  const sevCard = (sev: string) => ({
    background: sev === 'high' || sev === 'critical' ? 'rgba(127,29,29,0.15)' : sev === 'medium' || sev === 'warning' ? 'rgba(120,53,15,0.15)' : '#111827',
    border: `1px solid ${sev === 'high' || sev === 'critical' ? 'rgba(153,27,27,0.5)' : sev === 'medium' || sev === 'warning' ? 'rgba(146,64,14,0.5)' : '#374151'}`,
    borderRadius: 8, padding: 14, fontSize: 13,
  });
  const secTitle = (text: string) => (
    <p style={{ color: '#9ca3af', fontSize: 11, fontWeight: 600, marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' as const }}>{text}</p>
  );
  const infoGrid = (items: [string, string, string?][]) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
      {items.map(([label, value, color], i) => (
        <div key={i}><span style={{ color: '#6b7280' }}>{label}:</span> <span style={{ color: color || '#fff' }}>{value}</span></div>
      ))}
    </div>
  );

  return (
    <div style={{ background: '#1f2937', borderRadius: 8, border: '1px solid #374151', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h3 style={{ color: '#fff', fontWeight: 700, margin: 0, fontSize: 16 }}>🔮 The Unspoken Truth — Strategic Advisory</h3>
          <p style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>
            Powered by Claude Opus 4.6 {analysisTime ? `• Terakhir: ${timeAgo(analysisTime)}` : ''}
          </p>
        </div>
        <button onClick={generate} disabled={loading} style={{
          padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: loading ? '#374151' : 'linear-gradient(135deg, #d97706, #b45309)',
          color: '#fff', fontSize: 13, fontWeight: 600, opacity: loading ? 0.6 : 1,
        }}>
          {loading ? '⏳ Analyzing with Opus...' : analysis ? '🔄 Re-generate' : '⚡ Generate Analysis'}
        </button>
      </div>

      {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {!analysis && !loading && !loadingPrev && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>Klik &quot;Generate Analysis&quot; untuk insight strategis dari Claude Opus 4.6.</p>
      )}
      {loadingPrev && !analysis && <p style={{ color: '#6b7280', fontSize: 13 }}>Memuat analisis terakhir...</p>}

      {analysis && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Health Score ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              fontSize: 48, fontWeight: 900, lineHeight: 1,
              color: (analysis.health_score || 0) >= 70 ? '#34d399' : (analysis.health_score || 0) >= 40 ? '#fbbf24' : '#f87171',
            }}>{analysis.health_score}</div>
            <div>
              <p style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>{analysis.health_label}</p>
              <p style={{ color: '#9ca3af', fontSize: 13 }}>Business Health Score</p>
            </div>
          </div>

          {/* ── Unspoken Truth ── */}
          {analysis.unspoken_truth && (
            <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid rgba(153,27,27,0.5)', borderRadius: 8, padding: 16 }}>
              <p style={{ color: '#fca5a5', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>💀 The Unspoken Truth</p>
              <p style={{ color: '#f3f4f6', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{analysis.unspoken_truth}</p>
            </div>
          )}

          {/* ── Strategic Advice ── */}
          {analysis.strategic_advice && (
            <div style={{ background: '#111827', borderRadius: 8, padding: 16, border: '1px solid #374151' }}>
              {secTitle('🎯 Strategic Advice')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Stop */}
                <div style={{ background: 'rgba(127,29,29,0.1)', borderRadius: 6, padding: 12, border: '1px solid rgba(153,27,27,0.3)' }}>
                  <p style={{ color: '#f87171', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>🛑 STOP Minggu Ini</p>
                  {(analysis.strategic_advice.stop_immediately || []).map((s, i) => (
                    <p key={i} style={{ color: '#e5e7eb', fontSize: 12, marginBottom: 6, paddingLeft: 8, borderLeft: '2px solid #991b1b', lineHeight: 1.5 }}>{s}</p>
                  ))}
                </div>
                {/* Start */}
                <div style={{ background: 'rgba(6,78,59,0.1)', borderRadius: 6, padding: 12, border: '1px solid rgba(6,78,59,0.3)' }}>
                  <p style={{ color: '#34d399', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>🚀 START Bulan Ini</p>
                  {(analysis.strategic_advice.start_this_month || []).map((s, i) => (
                    <p key={i} style={{ color: '#e5e7eb', fontSize: 12, marginBottom: 6, paddingLeft: 8, borderLeft: '2px solid #065f46', lineHeight: 1.5 }}>{s}</p>
                  ))}
                </div>
              </div>
              {analysis.strategic_advice.big_decision_this_quarter && (
                <div style={{ marginTop: 12, background: 'rgba(120,53,15,0.1)', borderRadius: 6, padding: 12, border: '1px solid rgba(120,53,15,0.3)' }}>
                  <p style={{ color: '#fbbf24', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>⚡ Keputusan Besar Kuartal Ini</p>
                  <p style={{ color: '#f3f4f6', fontSize: 13, lineHeight: 1.6 }}>{analysis.strategic_advice.big_decision_this_quarter}</p>
                </div>
              )}
              {analysis.strategic_advice.if_only_one_brand && (
                <div style={{ marginTop: 12, background: 'rgba(88,28,135,0.1)', borderRadius: 6, padding: 12, border: '1px solid rgba(88,28,135,0.3)' }}>
                  <p style={{ color: '#c084fc', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>🏆 Jika Harus All-In 1 Brand</p>
                  <p style={{ color: '#f3f4f6', fontSize: 13, lineHeight: 1.6 }}>{analysis.strategic_advice.if_only_one_brand}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Cash Analysis ── */}
          {analysis.cash_analysis && (
            <div style={{ background: '#111827', borderRadius: 8, padding: 16, border: '1px solid #374151' }}>
              {secTitle('💰 Cash Analysis')}
              {infoGrid([
                ['Position', analysis.cash_analysis.current_position],
                ['Burn Rate', analysis.cash_analysis.burn_rate],
                ['Runway', analysis.cash_analysis.runway_assessment],
                ['Risk', (analysis.cash_analysis.risk_level || '').toUpperCase(),
                  analysis.cash_analysis.risk_level === 'critical' || analysis.cash_analysis.risk_level === 'high' ? '#f87171' :
                  analysis.cash_analysis.risk_level === 'medium' ? '#fbbf24' : '#34d399'],
              ])}
              {analysis.cash_analysis.cash_traps && (
                <div style={{ marginTop: 10, padding: 10, background: 'rgba(120,53,15,0.1)', borderRadius: 6, border: '1px solid rgba(120,53,15,0.2)' }}>
                  <p style={{ color: '#fbbf24', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>🪤 Cash Traps</p>
                  <p style={{ color: '#e5e7eb', fontSize: 12, lineHeight: 1.5 }}>{analysis.cash_analysis.cash_traps}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Revenue Quality ── */}
          {analysis.revenue_quality && (
            <div style={{ background: '#111827', borderRadius: 8, padding: 16, border: '1px solid #374151' }}>
              {secTitle('📈 Revenue Quality')}
              <p style={{ color: '#e5e7eb', fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{analysis.revenue_quality.assessment}</p>
              {analysis.revenue_quality.paid_vs_organic_dependency && (
                <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}><span style={{ color: '#fbbf24' }}>Ad Dependency:</span> {analysis.revenue_quality.paid_vs_organic_dependency}</p>
              )}
              {analysis.revenue_quality.if_ads_stopped && (
                <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}><span style={{ color: '#f87171' }}>If Ads Stopped:</span> {analysis.revenue_quality.if_ads_stopped}</p>
              )}
              {analysis.revenue_quality.concern && (
                <p style={{ color: '#9ca3af', fontSize: 12 }}><span style={{ color: '#fbbf24' }}>Concern:</span> {analysis.revenue_quality.concern}</p>
              )}
            </div>
          )}

          {/* ── Cost Alerts ── */}
          {analysis.cost_alerts && analysis.cost_alerts.length > 0 && (
            <div>
              {secTitle('⚠️ Cost Surgery')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {analysis.cost_alerts.map((alert: any, i: number) => (
                  <div key={i} style={sevCard(alert.severity)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <p style={{ color: '#fff', fontWeight: 600 }}>{alert.category}</p>
                      {alert.estimated_saving && <span style={{ color: '#34d399', fontSize: 11 }}>Saving: {alert.estimated_saving}</span>}
                    </div>
                    <p style={{ color: '#d1d5db', lineHeight: 1.5 }}>{alert.issue}</p>
                    <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 6 }}>→ {alert.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Hidden Patterns ── */}
          {analysis.hidden_patterns && analysis.hidden_patterns.length > 0 && (
            <div>
              {secTitle('🔍 Hidden Patterns')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {analysis.hidden_patterns.map((p: any, i: number) => (
                  <div key={i} style={{ background: '#111827', borderRadius: 8, padding: 14, border: '1px solid #374151', fontSize: 13 }}>
                    <p style={{ color: '#c084fc', fontWeight: 600, marginBottom: 4 }}>{p.pattern}</p>
                    <p style={{ color: '#d1d5db', lineHeight: 1.5, marginBottom: 4 }}>{p.evidence}</p>
                    <p style={{ color: '#fbbf24', fontSize: 12 }}>Implikasi: {p.implication}</p>
                    <p style={{ color: '#34d399', fontSize: 12, marginTop: 2 }}>Action: {p.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Strategic Risks ── */}
          {analysis.strategic_risks && analysis.strategic_risks.length > 0 && (
            <div>
              {secTitle('🎯 Strategic Risks')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {analysis.strategic_risks.map((risk: any, i: number) => (
                  <div key={i} style={{ background: '#111827', borderRadius: 8, padding: 14, border: '1px solid #374151', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: risk.probability === 'high' ? '#7f1d1d' : risk.probability === 'medium' ? '#78350f' : '#374151',
                        color: risk.probability === 'high' ? '#fecaca' : risk.probability === 'medium' ? '#fde68a' : '#d1d5db',
                      }}>{risk.probability}</span>
                      <span style={{ color: '#fff', fontWeight: 600 }}>{risk.risk}</span>
                    </div>
                    <p style={{ color: '#9ca3af', fontSize: 12 }}>Impact: {risk.impact}</p>
                    {risk.timeline && <p style={{ color: '#9ca3af', fontSize: 12 }}>Timeline: {risk.timeline}</p>}
                    <p style={{ color: '#9ca3af', fontSize: 12 }}>Mitigation: {risk.mitigation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Competitive Survival ── */}
          {analysis.competitive_survival && (
            <div style={{ background: '#111827', borderRadius: 8, padding: 16, border: '1px solid #374151' }}>
              {secTitle('⏱️ Competitive Survival')}
              {infoGrid([
                ['Runway (current rate)', analysis.competitive_survival.months_at_current_rate],
                ['Break-even req.', analysis.competitive_survival.break_even_requirement],
              ])}
              {analysis.competitive_survival.unit_economics_verdict && (
                <p style={{ color: '#e5e7eb', fontSize: 13, marginTop: 10, lineHeight: 1.6, padding: 10, background: 'rgba(55,65,81,0.3)', borderRadius: 6 }}>
                  {analysis.competitive_survival.unit_economics_verdict}
                </p>
              )}
            </div>
          )}

          {/* ── Key Ratios Alert ── */}
          {analysis.key_ratios_alert && analysis.key_ratios_alert.length > 0 && (
            <div>
              {secTitle('📊 Key Ratios Alert')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {analysis.key_ratios_alert.map((ra: any, i: number) => (
                  <div key={i} style={sevCard(ra.status === 'critical' ? 'high' : ra.status === 'warning' ? 'medium' : 'low')}>
                    <p style={{ color: '#fff', fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{ra.ratio}</p>
                    <p style={{ color: '#d1d5db', fontSize: 13 }}>{ra.current} <span style={{ color: '#6b7280', fontSize: 11 }}>({ra.benchmark})</span></p>
                    <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{ra.interpretation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function FinancePage() {
  const [pl, setPL] = useState<PLSummary[]>([]);
  const [cf, setCF] = useState<CFSummary[]>([]);
  const [ratios, setRatios] = useState<RatioData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const { createClient } = await import('@/lib/supabase-browser');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        setProfile(p);
      }
      const [plData, cfData, ratioData] = await Promise.all([
        getFinancialPLSummary(12),
        getFinancialCFSummary(12),
        getFinancialRatios(12),
      ]);
      setPL(plData);
      setCF(cfData);
      setRatios(ratioData);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  if (loading) return <div style={{ padding: 24, color: '#9ca3af' }}><p>Loading financial data...</p></div>;

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 8, padding: 16, color: '#fca5a5' }}>
          <p style={{ fontWeight: 700 }}>Error loading financial data</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>{error}</p>
          <p style={{ fontSize: 11, marginTop: 8, color: '#9ca3af' }}>Pastikan tabel financial sudah dibuat dan data sudah di-sync dari admin page.</p>
        </div>
      </div>
    );
  }

  if (pl.length === 0 && cf.length === 0 && ratios.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <p style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>📊 Finance Dashboard</p>
          <p style={{ color: '#9ca3af' }}>Belum ada data keuangan. Hubungkan dan sync Google Sheets di Admin page.</p>
        </div>
      </div>
    );
  }

  const latestPL = pl[0];
  const prevPL = pl[1];
  const latestCF = cf[0];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>📊 Finance</h1>
          <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 4 }}>
            Laporan Keuangan — Delivered Basis &nbsp;|&nbsp; Latest: {latestPL ? monthLabel(latestPL.month) : '-'}
          </p>
        </div>
        <button onClick={loadData} style={{
          background: 'transparent', border: '1px solid #374151', borderRadius: 6,
          padding: '6px 12px', color: '#9ca3af', fontSize: 12, cursor: 'pointer',
        }}>🔄 Refresh</button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <KPICard
          label="Net Revenue"
          value={fmtB(latestPL?.penjualan_bersih)}
          sub={prevPL ? `Prev: ${fmtB(prevPL.penjualan_bersih)}` : undefined}
          color={latestPL?.penjualan_bersih > (prevPL?.penjualan_bersih || 0) ? '#34d399' : '#f87171'}
        />
        <KPICard
          label="Laba Bersih"
          value={fmtB(latestPL?.laba_rugi)}
          sub={latestPL?.penjualan_bersih ? `NPM: ${fmtPct(latestPL.laba_rugi / latestPL.penjualan_bersih)}` : undefined}
          color={latestPL?.laba_rugi >= 0 ? '#34d399' : '#f87171'}
        />
        <KPICard
          label="Free Cash Flow"
          value={fmtB(latestCF?.free_cash_flow)}
          sub={latestCF?.saldo_kas_akhir ? `Saldo: ${fmtB(latestCF.saldo_kas_akhir)}` : undefined}
          color={latestCF?.free_cash_flow >= 0 ? '#34d399' : '#f87171'}
        />
        <KPICard
          label="GPM"
          value={latestPL?.penjualan_bersih ? fmtPct(latestPL.laba_bruto / latestPL.penjualan_bersih) : '-'}
          sub="Benchmark: 50-70%"
          color={latestPL?.penjualan_bersih && (latestPL.laba_bruto / latestPL.penjualan_bersih) >= 0.5 ? '#34d399' : '#fbbf24'}
        />
      </div>

      {profile?.role === 'owner' && <AIPanel pl={pl} cf={cf} ratios={ratios} userId={profile?.id} />}

      <PLTable data={pl} />
      <CFTable data={cf} />
      <RatiosTable data={ratios} />

      <div style={{ fontSize: 11, color: '#4b5563', textAlign: 'center', padding: '16px 0' }}>
        ⚠️ PL & CF = Delivered basis | Daily Income = Confirmed basis | Balance Sheet analysis disabled
      </div>
    </div>
  );
}
