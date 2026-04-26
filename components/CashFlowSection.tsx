// @ts-nocheck
// components/CashFlowSection.tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchLiveCashFlow } from '@/lib/cashflow-actions';
import { fmtCompact } from '@/lib/utils';

const CHANNEL_ORDER = [
  'TikTok Shop', 'Shopee', 'MP Lainnya',
  'Scalev Ads (COD)', 'Scalev Ads (Transfer)',
  'CS Manual (COD)', 'CS Manual (Transfer)',
];

const CH_COLORS: Record<string, string> = {
  'TikTok Shop': '#00f2ea', 'Shopee': '#ee4d2d', 'MP Lainnya': '#6366f1',
  'Scalev Ads (COD)': '#1877f2', 'Scalev Ads (Transfer)': '#60a5fa',
  'CS Manual (COD)': '#10b981', 'CS Manual (Transfer)': '#34d399',
};

const CATEGORY_KEYS = ['cash_received', 'spill_over', 'in_progress', 'overdue'] as const;
const CAT_LABELS: Record<string, string> = {
  cash_received: 'Received', spill_over: 'Spill Over',
  in_progress: 'In Progress', overdue: 'Overdue',
};
const CAT_COLORS: Record<string, string> = {
  cash_received: '#10b981', spill_over: '#8b5cf6',
  in_progress: '#f59e0b', overdue: '#ef4444',
};

interface Props { netSales: number; periodStart: string; }

export default function CashFlowSection({ netSales, periodStart }: Props) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);

  useEffect(() => { if (periodStart) loadCashFlow(); }, [periodStart]);

  function loadCashFlow() {
    setLoading(true); setError(null);
    fetchLiveCashFlow(periodStart)
      .then(d => { setData(d); setError(null); })
      .catch(err => setError(err?.message || 'Gagal memuat data cash flow'))
      .finally(() => setLoading(false));
  }

  const [y, m] = (periodStart || '2026-01').split('-').map(Number);
  const monthNames = ['','Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const periodLabel = `${monthNames[m]} ${y}`;

  const shell = (children: React.ReactNode) => (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden', marginBottom:16 }}>
      <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ fontSize:13, fontWeight:700 }}>Cash Flow Status</div>
        <div style={{ fontSize:11, color:'var(--dim)', marginTop:2 }}>{periodLabel} · Sumber data: Scalev Orders</div>
      </div>
      {children}
    </div>
  );

  if (loading) return shell(
    <div style={{ padding:'24px 20px', textAlign:'center', color:'var(--dim)', fontSize:12 }}>Memuat data cash flow...</div>
  );

  if (error || !data) return shell(
    <div style={{ padding:'24px 20px', textAlign:'center' }}>
      <div style={{ color:'var(--red)', fontSize:12, marginBottom:10 }}>{error || 'Data tidak tersedia'}</div>
      <button onClick={loadCashFlow} style={{ background:'var(--bg-deep)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-secondary)', padding:'6px 16px', fontSize:12, cursor:'pointer' }}>
        Coba Lagi
      </button>
    </div>
  );

  const totalCashIn = data.cashReceived + data.spillOver;
  const pct = (v: number) => netSales > 0 ? (v / netSales * 100) : 0;
  const byChannel = data.byChannel || {};
  const activeChannels = CHANNEL_ORDER.filter(ch =>
    CATEGORY_KEYS.some(cat => byChannel[cat]?.[ch]?.total > 0 || byChannel[cat]?.[ch]?.orders > 0)
  );

  const Row = ({ label, pctVal, amount, orders, color = 'var(--text-secondary)', indent = false, warn = false }: any) => (
    <div style={{ padding:`10px 20px 10px ${indent ? 32 : 20}px`, borderBottom:'1px solid var(--bg-deep)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:12, color: indent ? 'var(--dim)' : 'var(--text)' }}>
        {label}
        {warn && <span style={{ color:'var(--red)', marginLeft:6 }}>!</span>}
        <span style={{ fontSize:10, fontFamily:'monospace', opacity:0.65, marginLeft:6 }}>{pctVal.toFixed(1)}%</span>
      </span>
      <span style={{ fontFamily:'monospace', fontSize:12, color, whiteSpace:'nowrap' }}>
        Rp {fmtCompact(amount)}
        {orders != null && <span style={{ fontSize:10, color:'var(--dim)', marginLeft:6 }}>{orders.toLocaleString('id-ID')} ord</span>}
      </span>
    </div>
  );

  const SeparatorRow = ({ label, pctVal, amount, orders, color }: any) => (
    <div style={{ padding:'12px 20px', background:`${color}14`, borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:12, fontWeight:700, color }}>
        {label}
        <span style={{ fontSize:10, fontFamily:'monospace', fontWeight:400, opacity:0.75, marginLeft:6 }}>{pctVal.toFixed(1)}%</span>
      </span>
      <span style={{ fontFamily:'monospace', fontSize:14, fontWeight:700, color, whiteSpace:'nowrap' }}>
        Rp {fmtCompact(amount)}
        {orders != null && <span style={{ fontSize:10, fontWeight:400, color:'var(--dim)', marginLeft:6 }}>{orders.toLocaleString('id-ID')} ord</span>}
      </span>
    </div>
  );

  return shell(
    <>
      {/* Cash Masuk */}
      <Row label="Received (bulan ini)" pctVal={pct(data.cashReceived)} amount={data.cashReceived} orders={data.cashReceivedOrders} indent />
      <Row label="Spill Over (bulan lalu)" pctVal={pct(data.spillOver)} amount={data.spillOver} orders={data.spillOverOrders} indent />
      <SeparatorRow label="Total Cash Masuk" pctVal={pct(totalCashIn)} amount={totalCashIn} orders={data.cashReceivedOrders + data.spillOverOrders} color="#10b981" />

      {/* Cash Belum Masuk */}
      <Row label="In Progress (bulan ini)" pctVal={pct(data.cashInProgress)} amount={data.cashInProgress} orders={data.cashInProgressOrders} color="var(--yellow)" indent />
      <Row label="Overdue (bulan lalu)" pctVal={pct(data.overdue)} amount={data.overdue} orders={data.overdueOrders} color={data.overdueOrders > 0 ? 'var(--red)' : 'var(--text-secondary)'} indent warn={data.overdueOrders > 100} />

      {/* Progress bar */}
      <div style={{ height:4, display:'flex', overflow:'hidden', background:'var(--bg-deep)' }}>
        {pct(data.cashReceived) > 0 && <div style={{ width:`${pct(data.cashReceived)}%`, background:'#10b981' }} />}
        {pct(data.spillOver) > 0 && <div style={{ width:`${pct(data.spillOver)}%`, background:'#8b5cf6' }} />}
        {pct(data.cashInProgress) > 0 && <div style={{ width:`${Math.min(pct(data.cashInProgress), 100-pct(data.cashReceived)-pct(data.spillOver))}%`, background:'#f59e0b', opacity:0.6 }} />}
        {pct(data.overdue) > 0 && <div style={{ width:`${Math.min(pct(data.overdue),5)}%`, background:'#ef4444', opacity:0.8 }} />}
      </div>

      {/* Channel breakdown collapsible */}
      {activeChannels.length > 0 && (
        <div style={{ padding:'10px 20px' }}>
          <div onClick={() => setChannelOpen(!channelOpen)} style={{ fontSize:11, color:'var(--dim)', cursor:'pointer', userSelect:'none', display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ display:'inline-block', transition:'transform 0.2s', transform: channelOpen?'rotate(90deg)':'rotate(0deg)', fontSize:9 }}>&#9654;</span>
            Breakdown per Channel
          </div>
          {channelOpen && (
            <div style={{ overflowX:'auto', marginTop:10 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, tableLayout:'auto' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign:'left', minWidth:110 }}>Channel</th>
                    {CATEGORY_KEYS.map(cat => (
                      <th key={cat} style={{ ...thStyle, textAlign:'right' }}>
                        <span style={{ color:CAT_COLORS[cat] }}>{CAT_LABELS[cat]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeChannels.map(ch => {
                    const chColor = CH_COLORS[ch] || 'var(--text-secondary)';
                    return (
                      <tr key={ch} style={{ borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'8px 6px', whiteSpace:'nowrap' }}>
                          <span style={{ display:'inline-block', width:7, height:7, borderRadius:2, background:chColor, marginRight:6, verticalAlign:'middle' }} />
                          <span style={{ color:chColor, fontWeight:600 }}>{ch}</span>
                        </td>
                        {CATEGORY_KEYS.map(cat => {
                          const cell = byChannel[cat]?.[ch];
                          const val = cell?.total || 0;
                          const ord = cell?.orders || 0;
                          return (
                            <td key={cat} style={{ padding:'7px 6px', textAlign:'right', fontFamily:'monospace' }}>
                              {val > 0 ? (
                                <div>
                                  <div style={{ color:'var(--text)' }}>{fmtCompact(val)}</div>
                                  <div style={{ color:'var(--text-muted)', fontSize:9 }}>{ord.toLocaleString('id-ID')} ord</div>
                                </div>
                              ) : <span style={{ color:'var(--text-muted)' }}>-</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop:'2px solid var(--border)' }}>
                    <td style={{ padding:'8px 6px', fontWeight:700, color:'var(--text-secondary)' }}>Total</td>
                    {CATEGORY_KEYS.map(cat => {
                      const catTotal = activeChannels.reduce((s,ch) => s+(byChannel[cat]?.[ch]?.total||0),0);
                      const catOrders = activeChannels.reduce((s,ch) => s+(byChannel[cat]?.[ch]?.orders||0),0);
                      return (
                        <td key={cat} style={{ padding:'7px 6px', textAlign:'right', fontFamily:'monospace' }}>
                          <div style={{ color:CAT_COLORS[cat], fontWeight:700 }}>{fmtCompact(catTotal)}</div>
                          <div style={{ color:'var(--dim)', fontSize:9 }}>{catOrders.toLocaleString('id-ID')} ord</div>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const thStyle: React.CSSProperties = {
  padding:'6px 6px 8px', borderBottom:'2px solid var(--border)',
  fontWeight:600, color:'var(--dim)', fontSize:10,
  textTransform:'uppercase', letterSpacing:'0.04em',
};
