// @ts-nocheck
'use client';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { fmtRupiah } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
import { useActiveBrands } from '@/lib/ActiveBrandsContext';

// ── Template types ──
interface Template {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: any[];
}

// ── Status badge colors ──
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  APPROVED: { bg: '#064e3b', color: '#10b981' },
  PENDING:  { bg: '#78350f', color: '#f59e0b' },
  REJECTED: { bg: '#7f1d1d', color: '#ef4444' },
  PAUSED:   { bg: '#1e293b', color: '#94a3b8' },
};

const CATEGORY_STYLE: Record<string, { bg: string; color: string }> = {
  MARKETING:      { bg: '#1e3a5f', color: '#60a5fa' },
  UTILITY:        { bg: '#1a3636', color: '#2dd4bf' },
  AUTHENTICATION: { bg: '#3b1f4a', color: '#c084fc' },
};

export default function WabaManagementPage() {
  const supabase = useSupabase();
  const { dateRange, loading: dateLoading } = useDateRange();
  const { isActiveBrand } = useActiveBrands();

  // ── Template state ──
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [pagingAfter, setPagingAfter] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // ── Create form state ──
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('MARKETING');
  const [formLanguage, setFormLanguage] = useState('id');
  const [formBody, setFormBody] = useState('');
  const [formHeader, setFormHeader] = useState('');
  const [formFooter, setFormFooter] = useState('');
  const [formButtons, setFormButtons] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [varSamples, setVarSamples] = useState<Record<string, string>>({});
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // ── Body formatting helpers ──
  function wrapSelection(prefix: string, suffix: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = formBody.substring(start, end);
    const before = formBody.substring(0, start);
    const after = formBody.substring(end);
    if (selected) {
      const newText = before + prefix + selected + suffix + after;
      setFormBody(newText);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + prefix.length, end + prefix.length); }, 0);
    } else {
      const newText = before + prefix + suffix + after;
      setFormBody(newText);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + prefix.length, start + prefix.length); }, 0);
    }
  }

  function addVariable() {
    const nextNum = (detectedVars.length > 0)
      ? Math.max(...detectedVars.map(v => parseInt(v.replace(/\D/g, '')))) + 1
      : 1;
    const el = bodyRef.current;
    const pos = el ? el.selectionStart : formBody.length;
    const newText = formBody.substring(0, pos) + `{{${nextNum}}}` + formBody.substring(pos);
    setFormBody(newText);
    setTimeout(() => { if (el) { el.focus(); const np = pos + `{{${nextNum}}}`.length; el.setSelectionRange(np, np); } }, 0);
  }

  // ── Auto-detect variables in body text ──
  const detectedVars = useMemo(() => {
    const matches = formBody.match(/\{\{(\d+)\}\}/g) || [];
    const unique = [...new Set(matches)].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''));
      const numB = parseInt(b.replace(/\D/g, ''));
      return numA - numB;
    });
    return unique;
  }, [formBody]);

  // ── Preview body with samples substituted ──
  const previewBody = useMemo(() => {
    if (!formBody) return '';
    let text = formBody;
    for (const v of detectedVars) {
      const key = v.replace(/[{}]/g, '');
      const sample = varSamples[key];
      if (sample) {
        text = text.replaceAll(v, sample);
      }
    }
    return text;
  }, [formBody, detectedVars, varSamples]);

  // ── Analytics state ──
  const [adsData, setAdsData] = useState([]);
  const [channelData, setChannelData] = useState([]);
  const [shipmentCounts, setShipmentCounts] = useState([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);

  // ── Fetch templates ──
  const fetchTemplates = useCallback(async (after?: string) => {
    setLoadingTemplates(true);
    setTemplateError(null);
    try {
      const url = after ? `/api/waba-templates?after=${after}` : '/api/waba-templates';
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch templates');
      if (after) {
        setTemplates(prev => [...prev, ...json.data]);
      } else {
        setTemplates(json.data || []);
      }
      setPagingAfter(json.paging?.after || null);
    } catch (err: any) {
      setTemplateError(err.message);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // ── Fetch analytics data ──
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;

    const cachedAds = getCached('waba_ads_data', from, to);
    const cachedCh = getCached('waba_channel_data', from, to);
    const cachedSc = getCached('waba_shipment_counts', from, to);

    if (cachedAds && cachedCh && cachedSc) {
      setAdsData(cachedAds);
      setChannelData(cachedCh);
      setShipmentCounts(cachedSc);
      setLoadingAnalytics(false);
      return;
    }

    setLoadingAnalytics(true);
    Promise.all([
      supabase.from('daily_ads_spend')
        .select('date, source, spent, data_source, impressions, cpm')
        .gte('date', from).lte('date', to)
        .eq('data_source', 'whatsapp_api'),
      supabase.from('daily_channel_data')
        .select('date, product, channel, net_sales')
        .gte('date', from).lte('date', to)
        .eq('channel', 'WABA'),
      supabase.rpc('get_daily_shipment_counts', { p_from: from, p_to: to }),
    ]).then(([adsRes, chRes, scRes]) => {
      if (adsRes.error) console.error('[WABA] daily_ads_spend error:', adsRes.error);
      if (chRes.error) console.error('[WABA] daily_channel_data error:', chRes.error);
      if (scRes.error) console.error('[WABA] shipment_counts error:', scRes.error);

      const ads = adsRes.data || [];
      const ch = chRes.data || [];
      const sc = (scRes.data || []).filter(d => d.channel === 'WABA');

      setCache('waba_ads_data', from, to, ads);
      setCache('waba_channel_data', from, to, ch);
      setCache('waba_shipment_counts', from, to, sc);

      setAdsData(ads);
      setChannelData(ch);
      setShipmentCounts(sc);
      setLoadingAnalytics(false);
    });
  }, [dateRange, supabase]);

  // ── WABA Promotion Analysis ──
  const wabaAnalysis = useMemo(() => {
    const byDate: Record<string, { sent: number; delivered: number; orders: number; cost: number; revenue: number }> = {};

    adsData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 };
      byDate[d.date].sent += Number(d.impressions || 0);
      byDate[d.date].delivered += Number(d.cpm || 0);
      byDate[d.date].cost += Math.abs(Number(d.spent || 0));
    });

    channelData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 };
      byDate[d.date].revenue += Number(d.net_sales || 0);
    });

    shipmentCounts.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 };
      byDate[d.date].orders += Number(d.order_count || 0);
    });

    const rows = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        dateLabel: `${new Date(date).getDate()}/${new Date(date).getMonth() + 1}`,
        ...v,
        deliveryRate: v.sent > 0 ? (v.delivered / v.sent) * 100 : 0,
        costPerOrder: v.orders > 0 ? v.cost / v.orders : 0,
      }));

    const totals = rows.reduce((acc, r) => ({
      sent: acc.sent + r.sent,
      delivered: acc.delivered + r.delivered,
      orders: acc.orders + r.orders,
      cost: acc.cost + r.cost,
      revenue: acc.revenue + r.revenue,
    }), { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 });

    return {
      rows,
      totals: {
        ...totals,
        deliveryRate: totals.sent > 0 ? (totals.delivered / totals.sent) * 100 : 0,
        costPerOrder: totals.orders > 0 ? totals.cost / totals.orders : 0,
      },
    };
  }, [adsData, channelData, shipmentCounts]);

  // ── Create template handler ──
  async function handleCreate() {
    setFormError(null);
    if (!formBody.trim()) { setFormError('Body text is required'); return; }
    if (!formName.trim()) { setFormError('Template name is required'); return; }

    const components: any[] = [];
    if (formHeader.trim()) {
      components.push({ type: 'HEADER', format: 'TEXT', text: formHeader.trim() });
    }
    const bodyComponent: any = { type: 'BODY', text: formBody.trim() };
    // Include variable samples as example for Meta review
    if (detectedVars.length > 0) {
      const exampleValues = detectedVars.map(v => {
        const key = v.replace(/[{}]/g, '');
        return varSamples[key] || v;
      });
      bodyComponent.example = { body_text: [exampleValues] };
    }
    components.push(bodyComponent);
    if (formFooter.trim()) {
      components.push({ type: 'FOOTER', text: formFooter.trim() });
    }
    if (formButtons.filter(b => b.trim()).length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: formButtons.filter(b => b.trim()).map(text => ({ type: 'QUICK_REPLY', text: text.trim() })),
      });
    }

    setCreating(true);
    try {
      const res = await fetch('/api/waba-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, category: formCategory, language: formLanguage, components }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create template');

      // Reset form and refetch
      setFormName(''); setFormBody(''); setFormHeader(''); setFormFooter(''); setFormButtons([]); setVarSamples({});
      setShowCreateForm(false);
      fetchTemplates();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setCreating(false);
    }
  }

  // ── Delete template handler ──
  async function handleDelete(template: Template) {
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    setDeleting(template.id);
    try {
      const res = await fetch('/api/waba-templates', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hsm_id: template.id, name: template.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to delete template');
      setTemplates(prev => prev.filter(t => t.id !== template.id));
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    } finally {
      setDeleting(null);
    }
  }

  // ── Extract body text from components ──
  function getBodyText(components: any[]): string {
    const body = components?.find(c => c.type === 'BODY');
    return body?.text || '—';
  }

  // ── Render WhatsApp-formatted text as React elements ──
  function renderWaFormatted(text: string) {
    // Process formatting: *bold*, _italic_, ~strikethrough~, ```monospace```
    const parts: React.ReactNode[] = [];
    // Use regex to find formatted segments
    const regex = /(\*([^*]+)\*|_([^_]+)_|~([^~]+)~|```([^`]+)```)/g;
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      if (match[2]) parts.push(<strong key={key++}>{match[2]}</strong>);
      else if (match[3]) parts.push(<em key={key++}>{match[3]}</em>);
      else if (match[4]) parts.push(<s key={key++}>{match[4]}</s>);
      else if (match[5]) parts.push(<code key={key++} style={{ background: '#f0f0f0', borderRadius: 3, padding: '1px 4px', fontFamily: 'monospace', fontSize: 12 }}>{match[5]}</code>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.substring(lastIndex));
    return parts.length > 0 ? parts : text;
  }

  // ── Styles ──
  const card = { background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16 };
  const thStyle = { padding: '8px 10px', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' as const };
  const tdStyle = { padding: '8px 10px', fontSize: 11 };
  const inputStyle = {
    background: '#0b1121', border: '1px solid #1a2744', borderRadius: 6, padding: '8px 12px',
    color: '#e2e8f0', fontSize: 13, width: '100%', outline: 'none',
  };
  const selectStyle = { ...inputStyle, cursor: 'pointer' };
  const btnPrimary = {
    background: '#25D366', color: '#000', border: 'none', borderRadius: 6, padding: '8px 16px',
    fontWeight: 700, fontSize: 12, cursor: 'pointer',
  };
  const btnOutline = {
    background: 'transparent', border: '1px solid #1a2744', borderRadius: 6, padding: '8px 16px',
    color: '#94a3b8', fontWeight: 600, fontSize: 12, cursor: 'pointer',
  };
  const btnDanger = {
    background: 'transparent', border: '1px solid #7f1d1d', borderRadius: 6, padding: '4px 10px',
    color: '#ef4444', fontWeight: 600, fontSize: 11, cursor: 'pointer',
  };

  if (dateLoading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading...</div>;
  }

  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>WABA Management</h2>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Section A: Message Templates                                       */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Message Templates</div>
          <button style={btnPrimary} onClick={() => setShowCreateForm(!showCreateForm)}>
            {showCreateForm ? 'Cancel' : '+ Create Template'}
          </button>
        </div>

        {/* ── Create Form with Live Preview ── */}
        {showCreateForm && (
          <div style={{ background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>New Template</div>
            <div style={{ display: 'flex', gap: 20 }}>
              {/* ── Left: Form Fields ── */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Name</label>
                    <input style={inputStyle} value={formName} onChange={e => setFormName(e.target.value)}
                      placeholder="e.g. promo_january" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Category</label>
                    <select style={selectStyle} value={formCategory} onChange={e => setFormCategory(e.target.value as any)}>
                      <option value="MARKETING">Marketing</option>
                      <option value="UTILITY">Utility</option>
                      <option value="AUTHENTICATION">Authentication</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Language</label>
                    <select style={selectStyle} value={formLanguage} onChange={e => setFormLanguage(e.target.value)}>
                      <option value="id">Indonesian (id)</option>
                      <option value="en">English (en)</option>
                      <option value="en_US">English US (en_US)</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Header (optional)</label>
                  <input style={inputStyle} value={formHeader} onChange={e => setFormHeader(e.target.value)}
                    placeholder="Header text" />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Body *</label>
                  <textarea ref={bodyRef} style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={formBody}
                    onChange={e => setFormBody(e.target.value)}
                    placeholder="Hi {{1}}, check out our latest promo! Use code {{2}} for discount." />
                  {/* Formatting toolbar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginTop: 6 }}>
                    <button type="button" onClick={() => wrapSelection('*', '*')} title="Bold"
                      style={{ background: 'transparent', border: '1px solid #1a2744', borderRadius: 4, width: 30, height: 28, cursor: 'pointer', color: '#94a3b8', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      B
                    </button>
                    <button type="button" onClick={() => wrapSelection('_', '_')} title="Italic"
                      style={{ background: 'transparent', border: '1px solid #1a2744', borderRadius: 4, width: 30, height: 28, cursor: 'pointer', color: '#94a3b8', fontSize: 14, fontStyle: 'italic', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      I
                    </button>
                    <button type="button" onClick={() => wrapSelection('~', '~')} title="Strikethrough"
                      style={{ background: 'transparent', border: '1px solid #1a2744', borderRadius: 4, width: 30, height: 28, cursor: 'pointer', color: '#94a3b8', fontSize: 14, textDecoration: 'line-through', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      S
                    </button>
                    <button type="button" onClick={() => wrapSelection('```', '```')} title="Monospace"
                      style={{ background: 'transparent', border: '1px solid #1a2744', borderRadius: 4, width: 30, height: 28, cursor: 'pointer', color: '#94a3b8', fontSize: 12, fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {'</>'}
                    </button>
                    <div style={{ width: 1, height: 20, background: '#1a2744', margin: '0 4px' }} />
                    <button type="button" onClick={addVariable} title="Add variable"
                      style={{ background: 'transparent', border: '1px solid #1a2744', borderRadius: 4, height: 28, padding: '0 10px', cursor: 'pointer', color: '#60a5fa', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      + Add variable
                    </button>
                  </div>
                </div>

                {/* Variable Samples — auto-detected from body */}
                {detectedVars.length > 0 && (
                  <div style={{ marginBottom: 12, background: '#0d1526', border: '1px solid #1a2744', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Variable Samples</div>
                    <div style={{ fontSize: 10, color: '#475569', marginBottom: 10 }}>
                      Provide sample content for each variable to help Meta review your template.
                    </div>
                    {detectedVars.map(v => {
                      const key = v.replace(/[{}]/g, '');
                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                          <span style={{
                            background: '#1a2744', borderRadius: 4, padding: '4px 10px', fontSize: 12,
                            fontFamily: 'monospace', color: '#94a3b8', minWidth: 50, textAlign: 'center', flexShrink: 0,
                          }}>{v}</span>
                          <input style={inputStyle} value={varSamples[key] || ''}
                            onChange={e => setVarSamples(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={`Enter sample for ${v}`} />
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Footer (optional)</label>
                  <input style={inputStyle} value={formFooter} onChange={e => setFormFooter(e.target.value)}
                    placeholder="e.g. Reply STOP to unsubscribe" />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>Quick Reply Buttons (optional, max 3)</label>
                  {[0, 1, 2].map(i => (
                    <input key={i} style={{ ...inputStyle, marginBottom: 6 }}
                      value={formButtons[i] || ''} onChange={e => {
                        const next = [...formButtons];
                        next[i] = e.target.value;
                        setFormButtons(next);
                      }}
                      placeholder={`Button ${i + 1} text`} />
                  ))}
                </div>

                {formError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{formError}</div>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnPrimary} onClick={handleCreate} disabled={creating}>
                    {creating ? 'Creating...' : 'Submit Template'}
                  </button>
                  <button style={btnOutline} onClick={() => setShowCreateForm(false)}>Cancel</button>
                </div>

                <div style={{ fontSize: 11, color: '#475569', marginTop: 10 }}>
                  New templates go to PENDING status and require Meta review (usually minutes to hours).
                </div>
              </div>

              {/* ── Right: WhatsApp Chat Preview ── */}
              <div style={{ width: 320, flexShrink: 0 }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Template Preview</div>
                {/* Phone frame */}
                <div style={{ background: '#e5ddd5', borderRadius: 12, padding: 16, minHeight: 200, position: 'relative' }}>
                  {/* Chat wallpaper pattern */}
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 12, opacity: 0.05, background: 'url("data:image/svg+xml,%3Csvg width=\'40\' height=\'40\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M20 0L0 20h10L20 10l10 10h10z\' fill=\'%23000\'/%3E%3C/svg%3E")' }} />
                  {/* Message bubble */}
                  <div style={{ position: 'relative', background: '#fff', borderRadius: '0 8px 8px 8px', padding: '8px 10px', maxWidth: '100%', boxShadow: '0 1px 2px rgba(0,0,0,0.13)' }}>
                    {/* Header */}
                    {formHeader.trim() && (
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 4, lineHeight: 1.3 }}>
                        {formHeader}
                      </div>
                    )}
                    {/* Body */}
                    <div style={{ fontSize: 13, color: '#303030', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {previewBody ? renderWaFormatted(previewBody) : <span style={{ color: '#999' }}>Message body will appear here...</span>}
                    </div>
                    {/* Footer */}
                    {formFooter.trim() && (
                      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 6 }}>
                        {formFooter}
                      </div>
                    )}
                    {/* Timestamp */}
                    <div style={{ textAlign: 'right', marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: '#8c8c8c' }}>
                        {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  {/* Quick reply buttons */}
                  {formButtons.filter(b => b.trim()).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                      {formButtons.filter(b => b.trim()).map((btn, i) => (
                        <div key={i} style={{
                          background: '#fff', borderRadius: 8, padding: '8px 12px', textAlign: 'center',
                          fontSize: 13, color: '#00a5f4', fontWeight: 500, boxShadow: '0 1px 2px rgba(0,0,0,0.13)',
                          cursor: 'default',
                        }}>
                          {btn}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Category & Language info */}
                <div style={{ marginTop: 10, fontSize: 10, color: '#64748b' }}>
                  <div><strong>Category:</strong> {formCategory}</div>
                  <div><strong>Language:</strong> {formLanguage}</div>
                  {formName && <div><strong>Name:</strong> {formName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')}</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Template List ── */}
        {templateError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{templateError}</div>}

        {loadingTemplates && templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>Loading templates...</div>
        ) : templates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>No templates found</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #1a2744' }}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Name</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Category</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Language</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Body Preview</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => {
                    const ss = STATUS_STYLE[t.status] || STATUS_STYLE.PAUSED;
                    const cs = CATEGORY_STYLE[t.category] || CATEGORY_STYLE.UTILITY;
                    const bodyText = getBodyText(t.components);
                    const preview = bodyText.length > 80 ? bodyText.substring(0, 80) + '...' : bodyText;
                    return (
                      <tr key={t.id} style={{ borderBottom: '1px solid #1a2744' }}>
                        <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'monospace' }}>{t.name}</td>
                        <td style={tdStyle}>
                          <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: cs.bg, color: cs.color }}>
                            {t.category}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: ss.bg, color: ss.color }}>
                            {t.status}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8' }}>{t.language}</td>
                        <td style={{ ...tdStyle, color: '#94a3b8', maxWidth: 300 }}>{preview}</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button style={btnDanger} onClick={() => handleDelete(t)}
                            disabled={deleting === t.id}>
                            {deleting === t.id ? '...' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pagingAfter && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <button style={btnOutline} onClick={() => fetchTemplates(pagingAfter)} disabled={loadingTemplates}>
                  {loadingTemplates ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* Section B: WABA Promotion Analysis                                 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div style={{ ...card }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>WABA Promotion Analysis</div>

        {loadingAnalytics ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>Loading analytics...</div>
        ) : wabaAnalysis.rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>No WABA data for selected period</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #1a2744' }}>
                  {['Date', 'MM Sent', 'MM Delivered', 'Delivery Rate', 'Order Qty', 'WABA MM Cost', 'Total Purchase', 'Cost/Order'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Date' ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wabaAnalysis.rows.map(r => (
                  <tr key={r.date} style={{ borderBottom: '1px solid #1a2744' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{r.dateLabel}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                      {r.sent > 0 ? r.sent.toLocaleString() : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                      {r.delivered > 0 ? r.delivered.toLocaleString() : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {r.sent > 0 ? (
                        <span style={{
                          padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                          background: r.deliveryRate >= 95 ? '#064e3b' : r.deliveryRate >= 85 ? '#78350f' : '#7f1d1d',
                          color: r.deliveryRate >= 95 ? '#10b981' : r.deliveryRate >= 85 ? '#f59e0b' : '#ef4444',
                        }}>{r.deliveryRate.toFixed(1)}%</span>
                      ) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>
                      {r.orders > 0 ? r.orders.toLocaleString() : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#25D366' }}>
                      {r.cost > 0 ? fmtRupiah(r.cost) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                      {r.revenue > 0 ? fmtRupiah(r.revenue) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                      {r.orders > 0 ? fmtRupiah(r.costPerOrder) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{wabaAnalysis.totals.sent.toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{wabaAnalysis.totals.delivered.toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    {wabaAnalysis.totals.sent > 0 ? (
                      <span style={{
                        padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                        background: wabaAnalysis.totals.deliveryRate >= 95 ? '#064e3b' : '#78350f',
                        color: wabaAnalysis.totals.deliveryRate >= 95 ? '#10b981' : '#f59e0b',
                      }}>{wabaAnalysis.totals.deliveryRate.toFixed(1)}%</span>
                    ) : <span style={{ color: '#334155' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{wabaAnalysis.totals.orders.toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#25D366' }}>{fmtRupiah(wabaAnalysis.totals.cost)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(wabaAnalysis.totals.revenue)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{wabaAnalysis.totals.orders > 0 ? fmtRupiah(wabaAnalysis.totals.costPerOrder) : <span style={{ color: '#334155' }}>—</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
