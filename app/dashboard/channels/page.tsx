// @ts-nocheck
'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, CHANNEL_COLORS } from '@/lib/utils';
import DateRangePicker from '@/components/DateRangePicker';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

export default function ChannelsPage() {
  const supabase = createClient();
  const [data, setData] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [dateExtent, setDateExtent] = useState({ earliest: '', latest: '' });

  useEffect(() => {
    async function init() {
      const { data: f } = await supabase.from('daily_channel_data').select('date').order('date',{ascending:true}).limit(1);
      const { data: l } = await supabase.from('daily_channel_data').select('date').order('date',{ascending:false}).limit(1);
      setDateExtent({ earliest: f?.[0]?.date||'', latest: l?.[0]?.date||'' });
      setDateRange({ from: f?.[0]?.date||'', to: l?.[0]?.date||'' });
    }
    init();
  }, [supabase]);

  useEffect(() => {
    if (!dateRange.from) return;
    supabase.from('daily_channel_data').select('channel, net_sales, gross_profit').gte('date',dateRange.from).lte('date',dateRange.to)
      .then(({ data:d }) => setData(d || []));
  }, [dateRange, supabase]);

  const channels = useMemo(() => {
    const byC: Record<string, { s:number; g:number }> = {};
    data.forEach((d:any) => {
      if (!byC[d.channel]) byC[d.channel] = { s:0, g:0 };
      byC[d.channel].s += Number(d.net_sales); byC[d.channel].g += Number(d.gross_profit);
    });
    const total = Object.values(byC).reduce((a,v)=>a+v.s,0);
    return Object.entries(byC).filter(([,v])=>v.s>0).sort((a,b)=>b[1].s-a[1].s)
      .map(([ch,v]) => ({ name:ch, value:v.s, gp:v.g, pct:total>0?v.s/total*100:0, margin:v.s>0?v.g/v.s*100:0 }));
  }, [data]);

  return (
    <div className="fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:12 }}>
        <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>Channel</h2>
        <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={(f,t)=>setDateRange({from:f,to:t})} earliest={dateExtent.earliest} latest={dateExtent.latest} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:16 }}>
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Revenue Share</div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart><Pie data={channels} cx="50%" cy="50%" innerRadius={60} outerRadius={105} dataKey="value" nameKey="name" stroke="#0b1121" strokeWidth={3}>
              {channels.map((c,i) => <Cell key={i} fill={CHANNEL_COLORS[c.name]||'#64748b'} />)}
            </Pie><Tooltip formatter={(v:number)=>fmtRupiah(v)} /></PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Detail</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {channels.map(c => (
              <div key={c.name} style={{ padding:10, background:'#0b1121', borderRadius:8, border:'1px solid #1a2744' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:CHANNEL_COLORS[c.name]||'#64748b' }} />
                    <span style={{ fontWeight:600, fontSize:13 }}>{c.name}</span>
                  </div>
                  <span style={{ fontFamily:'monospace', fontWeight:700, fontSize:12 }}>Rp {fmtCompact(c.value)}</span>
                </div>
                <div style={{ height:4, borderRadius:2, background:'#1a2744', overflow:'hidden', marginBottom:3 }}>
                  <div style={{ width:`${c.pct}%`, height:'100%', borderRadius:2, background:CHANNEL_COLORS[c.name]||'#64748b' }} />
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#64748b' }}>
                  <span>{c.pct.toFixed(1)}% revenue</span><span>GP Margin: {c.margin.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
