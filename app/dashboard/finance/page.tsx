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
  cash_analysis?: any;
  revenue_quality?: any;
  cost_alerts?: any[];
  strategic_risks?: any[];
  cash_proxy_analysis?: any;
  key_ratios_alert?: any[];
}

// ============================================================
// HELPERS
// ============================================================

function fmtB(n: number | null): string {
  if (!n && n !== 0) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}Rp ${(abs / 1e6).toFixed(1)}M`;
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

// ============================================================
// KPI CARD
// ============================================================

function KPICard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-xl font-bold ${color || 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs mt-1 text-gray-500">{sub}</p>}
    </div>
  );
}

// ============================================================
// PL TABLE
// ============================================================

function PLTable({ data }: { data: PLSummary[] }) {
  if (!data.length) return null;
  const recent = data.slice(0, 6);

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
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-x-auto">
      <h3 className="text-white font-bold mb-3">📋 Profit & Loss — Delivered Basis</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left text-gray-400 py-2 pr-4 sticky left-0 bg-gray-800 min-w-[180px]">Item</th>
            {recent.map(r => (
              <th key={r.month} className="text-right text-gray-400 py-2 px-2 min-w-[110px]">{monthLabel(r.month)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(item => (
            <tr key={item.key} className={`border-b border-gray-700/30 ${item.bold ? 'font-semibold' : ''}`}>
              <td className={`py-1.5 pr-4 sticky left-0 bg-gray-800 ${item.bold ? 'text-white' : 'text-gray-300'} whitespace-nowrap`}>
                {item.label}
              </td>
              {recent.map(r => {
                const val = (r as any)[item.key] as number;
                return (
                  <td key={r.month} className={`text-right py-1.5 px-2 ${val < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                    {fmtB(val)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t border-gray-600">
            <td className="py-1.5 pr-4 sticky left-0 bg-gray-800 text-gray-400 italic">GPM</td>
            {recent.map(r => (
              <td key={r.month} className="text-right py-1.5 px-2 text-gray-400 italic">
                {r.penjualan_bersih ? fmtPct(r.laba_bruto / r.penjualan_bersih) : '-'}
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-1.5 pr-4 sticky left-0 bg-gray-800 text-gray-400 italic">NPM</td>
            {recent.map(r => (
              <td key={r.month} className="text-right py-1.5 px-2 text-gray-400 italic">
                {r.penjualan_bersih ? fmtPct(r.laba_rugi / r.penjualan_bersih) : '-'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// CF TABLE
// ============================================================

function CFTable({ data }: { data: CFSummary[] }) {
  if (!data.length) return null;
  const recent = data.slice(0, 6);

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
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-x-auto">
      <h3 className="text-white font-bold mb-3">💰 Cash Flow</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left text-gray-400 py-2 pr-4 sticky left-0 bg-gray-800 min-w-[180px]">Item</th>
            {recent.map(r => (
              <th key={r.month} className="text-right text-gray-400 py-2 px-2 min-w-[110px]">{monthLabel(r.month)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(item => (
            <tr key={item.key} className={`border-b border-gray-700/30 ${item.bold ? 'font-semibold' : ''}`}>
              <td className={`py-1.5 pr-4 sticky left-0 bg-gray-800 ${item.bold ? 'text-white' : 'text-gray-300'} whitespace-nowrap`}>
                {item.label}
              </td>
              {recent.map(r => {
                const val = (r as any)[item.key] as number;
                return (
                  <td key={r.month} className={`text-right py-1.5 px-2 ${val < 0 ? 'text-red-400' : 'text-gray-200'}`}>
                    {fmtB(val)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="border-t border-gray-600">
            <td className="py-1.5 pr-4 sticky left-0 bg-gray-800 text-gray-400 italic">Cash Efficiency</td>
            {recent.map(r => {
              const totalIn = (r.penerimaan_pelanggan || 0) + (r.penerimaan_reseller || 0);
              const eff = totalIn > 0 ? (r.cf_operasi || 0) / totalIn : null;
              return (
                <td key={r.month} className={`text-right py-1.5 px-2 italic ${eff !== null && eff < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                  {eff !== null ? fmtPct(eff) : '-'}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// RATIOS TABLE
// ============================================================

function RatiosTable({ data }: { data: RatioData[] }) {
  if (!data.length) return null;

  // Group by ratio, get latest month
  const months = [...new Set(data.map(d => d.month))].sort().reverse().slice(0, 6);
  const ratioNames = [...new Set(data.map(d => d.ratio_name))];

  // Nice labels
  const niceLabel: Record<string, string> = {
    gpm: 'Gross Profit Margin', npm: 'Net Profit Margin',
    roa: 'Return on Assets', roe: 'Return on Equity',
    cash_ratio: 'Cash Ratio', current_ratio: 'Current Ratio',
    quick_ratio: 'Quick Ratio', debt_ratio: 'Debt Ratio',
    ccr: 'Cash Conversion Ratio', ocf_to_asset: 'OCF to Asset',
    asset_turnover: 'Asset Turnover', inventory_turnover: 'Inventory Turnover',
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-x-auto">
      <h3 className="text-white font-bold mb-3">📊 Rasio Keuangan vs Benchmark</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left text-gray-400 py-2 pr-4 sticky left-0 bg-gray-800 min-w-[170px]">Rasio</th>
            <th className="text-center text-gray-400 py-2 px-2 min-w-[90px]">Benchmark</th>
            {months.map(m => (
              <th key={m} className="text-right text-gray-400 py-2 px-2 min-w-[80px]">{monthLabel(m)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ratioNames.map(rn => {
            const items = data.filter(d => d.ratio_name === rn);
            const benchmark = items[0]?.benchmark_label || '-';
            const bMin = items[0]?.benchmark_min;
            const bMax = items[0]?.benchmark_max;
            return (
              <tr key={rn} className="border-b border-gray-700/30">
                <td className="py-1.5 pr-4 sticky left-0 bg-gray-800 text-gray-300 whitespace-nowrap">
                  {niceLabel[rn] || rn}
                </td>
                <td className="text-center py-1.5 px-2 text-gray-500 text-xs">{benchmark}</td>
                {months.map(m => {
                  const item = items.find(i => i.month === m);
                  if (!item) return <td key={m} className="text-right py-1.5 px-2 text-gray-600">-</td>;
                  const status = ratioStatus(item.value, bMin ?? null, bMax ?? null);
                  const colorClass = status === 'healthy' ? 'text-emerald-400' : status === 'warning' ? 'text-amber-400' : 'text-red-400';
                  const isPercent = ['gpm', 'npm', 'roa', 'roe', 'ocf_to_asset'].includes(rn);
                  return (
                    <td key={m} className={`text-right py-1.5 px-2 ${colorClass}`}>
                      {isPercent ? fmtPct(item.value) : item.value.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">
        <span className="text-emerald-400">●</span> Dalam benchmark &nbsp;
        <span className="text-amber-400">●</span> Di luar benchmark &nbsp;
        <span className="text-red-400">●</span> Jauh di luar benchmark
      </p>
    </div>
  );
}

// ============================================================
// AI ANALYSIS PANEL
// ============================================================

function AIPanel({ pl, cf, ratios }: { pl: PLSummary[]; cf: CFSummary[]; ratios: RatioData[] }) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/financial-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'executive', numMonths: 6 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Parse JSON from response
      const parsed = JSON.parse(data.analysis);
      setAnalysis(parsed);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold">🔍 The Unspoken Truth — AI Analysis</h3>
        <button
          onClick={generate}
          disabled={loading}
          className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium"
        >
          {loading ? '⏳ Analyzing...' : '⚡ Generate Analysis'}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {!analysis && !loading && (
        <p className="text-gray-500 text-sm">
          Klik &quot;Generate Analysis&quot; untuk mendapatkan insight AI dari data keuangan.
          Memerlukan ANTHROPIC_API_KEY di environment variables.
        </p>
      )}

      {analysis && (
        <div className="space-y-4">
          {/* Health Score */}
          <div className="flex items-center gap-4">
            <div className={`text-4xl font-black ${
              (analysis.health_score || 0) >= 70 ? 'text-emerald-400' :
              (analysis.health_score || 0) >= 40 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {analysis.health_score}
            </div>
            <div>
              <p className="text-white font-bold">{analysis.health_label}</p>
              <p className="text-gray-400 text-sm">Health Score</p>
            </div>
          </div>

          {/* Unspoken Truth */}
          {analysis.unspoken_truth && (
            <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-4">
              <p className="text-red-300 text-sm font-medium mb-1">💀 The Unspoken Truth</p>
              <p className="text-white text-sm">{analysis.unspoken_truth}</p>
            </div>
          )}

          {/* Cash Analysis */}
          {analysis.cash_analysis && (
            <div className="bg-gray-900 rounded-lg p-3">
              <p className="text-gray-400 text-xs font-medium mb-2">💰 CASH ANALYSIS</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-gray-500">Position:</span> <span className="text-white">{analysis.cash_analysis.current_position}</span></div>
                <div><span className="text-gray-500">Burn Rate:</span> <span className="text-white">{analysis.cash_analysis.burn_rate}</span></div>
                <div><span className="text-gray-500">Runway:</span> <span className="text-white">{analysis.cash_analysis.runway_assessment}</span></div>
                <div><span className="text-gray-500">Risk:</span> <span className={
                  analysis.cash_analysis.risk_level === 'high' || analysis.cash_analysis.risk_level === 'critical' ? 'text-red-400' :
                  analysis.cash_analysis.risk_level === 'medium' ? 'text-amber-400' : 'text-emerald-400'
                }>{analysis.cash_analysis.risk_level?.toUpperCase()}</span></div>
              </div>
            </div>
          )}

          {/* Cost Alerts */}
          {analysis.cost_alerts && analysis.cost_alerts.length > 0 && (
            <div>
              <p className="text-gray-400 text-xs font-medium mb-2">⚠️ COST ALERTS</p>
              <div className="space-y-2">
                {analysis.cost_alerts.map((alert: any, i: number) => (
                  <div key={i} className={`rounded p-2 border text-sm ${
                    alert.severity === 'high' ? 'bg-red-900/20 border-red-800/50' :
                    alert.severity === 'medium' ? 'bg-amber-900/20 border-amber-800/50' :
                    'bg-gray-900 border-gray-700'
                  }`}>
                    <p className="text-white font-medium">{alert.category}</p>
                    <p className="text-gray-300">{alert.issue}</p>
                    <p className="text-gray-400 text-xs mt-1">→ {alert.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strategic Risks */}
          {analysis.strategic_risks && analysis.strategic_risks.length > 0 && (
            <div>
              <p className="text-gray-400 text-xs font-medium mb-2">🎯 STRATEGIC RISKS</p>
              <div className="space-y-2">
                {analysis.strategic_risks.map((risk: any, i: number) => (
                  <div key={i} className="bg-gray-900 rounded p-2 border border-gray-700 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        risk.probability === 'high' ? 'bg-red-800 text-red-200' :
                        risk.probability === 'medium' ? 'bg-amber-800 text-amber-200' :
                        'bg-gray-700 text-gray-300'
                      }`}>{risk.probability}</span>
                      <span className="text-white">{risk.risk}</span>
                    </div>
                    <p className="text-gray-400 text-xs mt-1">Impact: {risk.impact}</p>
                    <p className="text-gray-400 text-xs">Mitigation: {risk.mitigation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Ratios Alert */}
          {analysis.key_ratios_alert && analysis.key_ratios_alert.length > 0 && (
            <div>
              <p className="text-gray-400 text-xs font-medium mb-2">📊 KEY RATIOS</p>
              <div className="grid grid-cols-2 gap-2">
                {analysis.key_ratios_alert.map((ra: any, i: number) => (
                  <div key={i} className={`rounded p-2 border text-sm ${
                    ra.status === 'critical' ? 'bg-red-900/20 border-red-800/50' :
                    ra.status === 'warning' ? 'bg-amber-900/20 border-amber-800/50' :
                    'bg-emerald-900/20 border-emerald-800/50'
                  }`}>
                    <p className="text-white font-medium text-xs">{ra.ratio}</p>
                    <p className="text-gray-300">{ra.current} <span className="text-gray-500 text-xs">({ra.benchmark})</span></p>
                    <p className="text-gray-400 text-xs">{ra.interpretation}</p>
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

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [plData, cfData, ratioData] = await Promise.all([
        getFinancialPLSummary(12),
        getFinancialCFSummary(12),
        getFinancialRatios(12),
      ]);
      setPL(plData);
      setCF(cfData);
      setRatios(ratioData);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="p-6 text-gray-400">
        <p>Loading financial data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-900/20 border border-red-800 rounded p-4 text-red-300">
          <p className="font-bold">Error loading financial data</p>
          <p className="text-sm mt-1">{error}</p>
          <p className="text-xs mt-2 text-gray-400">
            Pastikan tabel financial sudah dibuat dan data sudah di-sync dari admin page.
          </p>
        </div>
      </div>
    );
  }

  const noData = pl.length === 0 && cf.length === 0 && ratios.length === 0;

  if (noData) {
    return (
      <div className="p-6">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
          <p className="text-white text-lg font-bold mb-2">📊 Finance Dashboard</p>
          <p className="text-gray-400 mb-4">
            Belum ada data keuangan. Hubungkan dan sync Google Sheets laporan keuangan di Admin page.
          </p>
        </div>
      </div>
    );
  }

  // Top KPIs from latest month
  const latestPL = pl[0];
  const prevPL = pl[1];
  const latestCF = cf[0];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📊 Finance</h1>
          <p className="text-gray-400 text-sm mt-1">
            Laporan Keuangan — Delivered Basis &nbsp;|&nbsp; Latest: {latestPL ? monthLabel(latestPL.month) : '-'}
          </p>
        </div>
        <button onClick={loadData} className="text-gray-400 hover:text-white text-sm">🔄 Refresh</button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          label="Net Revenue"
          value={fmtB(latestPL?.penjualan_bersih)}
          sub={prevPL ? `Prev: ${fmtB(prevPL.penjualan_bersih)}` : undefined}
          color={latestPL?.penjualan_bersih > (prevPL?.penjualan_bersih || 0) ? 'text-emerald-400' : 'text-red-400'}
        />
        <KPICard
          label="Laba Bersih"
          value={fmtB(latestPL?.laba_rugi)}
          sub={latestPL?.penjualan_bersih ? `NPM: ${fmtPct(latestPL.laba_rugi / latestPL.penjualan_bersih)}` : undefined}
          color={latestPL?.laba_rugi >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <KPICard
          label="Free Cash Flow"
          value={fmtB(latestCF?.free_cash_flow)}
          sub={latestCF?.saldo_kas_akhir ? `Saldo: ${fmtB(latestCF.saldo_kas_akhir)}` : undefined}
          color={latestCF?.free_cash_flow >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <KPICard
          label="GPM"
          value={latestPL?.penjualan_bersih ? fmtPct(latestPL.laba_bruto / latestPL.penjualan_bersih) : '-'}
          sub="Benchmark: 50-70%"
          color={latestPL?.penjualan_bersih && (latestPL.laba_bruto / latestPL.penjualan_bersih) >= 0.5 ? 'text-emerald-400' : 'text-amber-400'}
        />
      </div>

      {/* AI Analysis Panel */}
      <AIPanel pl={pl} cf={cf} ratios={ratios} />

      {/* PL Table */}
      <PLTable data={pl} />

      {/* CF Table */}
      <CFTable data={cf} />

      {/* Ratios Table */}
      <RatiosTable data={ratios} />

      {/* Disclaimer */}
      <div className="text-xs text-gray-600 text-center py-4">
        ⚠️ PL & CF = Delivered basis | Daily Income = Confirmed basis | Balance Sheet analysis disabled
      </div>
    </div>
  );
}
