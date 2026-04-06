// @ts-nocheck
// v7 - added brand-analysis tab
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSupabase } from '@/lib/supabase-browser';
import { ALL_TABS, canAccessTab } from '@/lib/utils';
import { DateRangeProvider, useDateRange } from '@/lib/DateRangeContext';
import DateRangePicker from '@/components/DateRangePicker';
import { ActiveBrandsProvider } from '@/lib/ActiveBrandsContext';
import ThemeToggle from '@/components/ThemeToggle';

function getCurrentTab(path) {
  const seg = path.replace('/dashboard', '').replace(/^\//, '');
  return seg || 'overview';
}

function getAllowedTabs(prof) {
  if (!prof) return [];
  if (prof.role === 'staff') {
    return ['admin'];
  }
  if (prof.role === 'warehouse_manager') {
    return ['warehouse'];
  }
  if (prof.role === 'ppic') {
    return ['warehouse', 'ppic'];
  }
  if (prof.role === 'brand_manager') {
    return prof.allowed_tabs && prof.allowed_tabs.length > 0 ? prof.allowed_tabs : ['marketing'];
  }
  if (prof.role === 'sales_manager') {
    return ['channels', 'waba-management'];
  }
  return null; // owner, admin, finance, direktur_operasional, manager → all tabs
}

function RefreshViewsButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [showDetail, setShowDetail] = useState(false);
  const [steps, setSteps] = useState({
    sheets: 'pending' as 'pending' | 'running' | 'success' | 'error' | 'skipped',
    meta: 'pending' as 'pending' | 'running' | 'success' | 'error' | 'skipped',
  });
  const [stepMessages, setStepMessages] = useState({ sheets: '', meta: '' });
  const detailRef = useRef<HTMLDivElement>(null);

  // Close detail popup on outside click
  useEffect(() => {
    if (!showDetail) return;
    const handler = (e: MouseEvent) => {
      if (detailRef.current && !detailRef.current.contains(e.target as Node)) {
        setShowDetail(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDetail]);

  const handleRefresh = async () => {
    setStatus('loading');
    setShowDetail(true);
    setSteps({ sheets: 'running', meta: 'running' });
    setStepMessages({ sheets: '', meta: '' });

    let sheetsOk = false;
    let metaOk = false;

    // Step 1: Run Google Sheets sync & Meta Ads sync in parallel
    const [sheetsRes, metaRes] = await Promise.allSettled([
      fetch('/api/sync', { method: 'POST' }).then(async r => {
        const d = await r.json();
        return { ok: r.ok, data: d };
      }),
      fetch('/api/meta-sync', { method: 'POST' }).then(async r => {
        const d = await r.json();
        return { ok: r.ok, data: d };
      }),
    ]);

    // Process Google Sheets result
    if (sheetsRes.status === 'fulfilled') {
      const { ok, data } = sheetsRes.value;
      if (ok && !data.error) {
        const synced = data.synced ?? 0;
        const failed = data.failed ?? 0;
        if (synced === 0 && failed === 0) {
          setSteps(s => ({ ...s, sheets: 'skipped' }));
          setStepMessages(s => ({ ...s, sheets: 'Tidak ada sheet aktif' }));
        } else {
          sheetsOk = true;
          setSteps(s => ({ ...s, sheets: 'success' }));
          setStepMessages(s => ({ ...s, sheets: `${synced} synced${failed > 0 ? `, ${failed} gagal` : ''}` }));
        }
      } else {
        setSteps(s => ({ ...s, sheets: 'error' }));
        setStepMessages(s => ({ ...s, sheets: data.error || data.message || 'Gagal' }));
      }
    } else {
      setSteps(s => ({ ...s, sheets: 'error' }));
      setStepMessages(s => ({ ...s, sheets: 'Network error' }));
    }

    // Process Meta Ads result
    if (metaRes.status === 'fulfilled') {
      const { ok, data } = metaRes.value;
      if (ok && !data.error) {
        const rows = data.rows_inserted ?? 0;
        const accts = data.accounts_synced ?? 0;
        if (accts === 0 && rows === 0 && data.message) {
          setSteps(s => ({ ...s, meta: 'skipped' }));
          setStepMessages(s => ({ ...s, meta: 'Tidak ada akun aktif' }));
        } else {
          metaOk = true;
          setSteps(s => ({ ...s, meta: data.status === 'failed' ? 'error' : 'success' }));
          setStepMessages(s => ({ ...s, meta: `${accts} akun, ${rows} baris${data.token_warning ? ' ⚠️' : ''}` }));
        }
      } else {
        setSteps(s => ({ ...s, meta: 'error' }));
        setStepMessages(s => ({ ...s, meta: data.error || 'Gagal' }));
      }
    } else {
      setSteps(s => ({ ...s, meta: 'error' }));
      setStepMessages(s => ({ ...s, meta: 'Network error' }));
    }

    // Done — summary tables are updated automatically via triggers
    setStatus(sheetsOk || metaOk ? 'success' : 'error');
    if (sheetsOk || metaOk) {
      setTimeout(() => window.location.reload(), 1200);
    } else {
      setTimeout(() => setStatus('idle'), 4000);
    }
  };

  const stepIcon = (state: string) => {
    switch (state) {
      case 'running': return '⟳';
      case 'success': return '✓';
      case 'error': return '✗';
      case 'skipped': return '—';
      default: return '○';
    }
  };
  const stepColor = (state: string) => {
    switch (state) {
      case 'running': return '#60a5fa';
      case 'success': return '#22c55e';
      case 'error': return '#ef4444';
      case 'skipped': return 'var(--dim)';
      default: return 'var(--text-muted)';
    }
  };

  const icon = {
    idle: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
      </svg>
    ),
    loading: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        style={{ animation: 'spin 0.8s linear infinite' }}>
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
      </svg>
    ),
    success: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    error: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
  };

  return (
    <div style={{ position: 'relative' }} ref={detailRef}>
      <button
        onClick={handleRefresh}
        disabled={status === 'loading'}
        title="Sync semua data & refresh dashboard"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 34, height: 34, borderRadius: 8,
          border: '1px solid var(--border)',
          background: status === 'loading' ? 'var(--border)' : 'var(--card)',
          color: 'var(--text-secondary)', cursor: status === 'loading' ? 'wait' : 'pointer',
          transition: 'all 0.15s ease', flexShrink: 0,
        }}
      >
        {icon[status]}
      </button>

      {/* Detail popup showing sync progress */}
      {showDetail && status === 'loading' && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '12px 14px', minWidth: 250, zIndex: 999,
          boxShadow: 'var(--shadow)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Sync Progress
          </div>
          {[
            { key: 'sheets', label: 'Google Sheets' },
            { key: 'meta', label: 'Meta Ads' },
          ].map(({ key, label }) => (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
              fontSize: 12, color: stepColor(steps[key]),
            }}>
              <span style={{
                width: 18, textAlign: 'center', fontWeight: 700, fontSize: 13,
                animation: steps[key] === 'running' ? 'spin 1s linear infinite' : 'none',
                display: 'inline-block',
              }}>
                {stepIcon(steps[key])}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text)', minWidth: 95 }}>{label}</span>
              <span style={{ color: stepColor(steps[key]), fontSize: 11, flex: 1, textAlign: 'right' }}>
                {stepMessages[key] || (steps[key] === 'running' ? 'Syncing...' : steps[key] === 'pending' ? 'Menunggu' : '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HeaderDatePicker() {
  const { dateRange, dateExtent, setDateRange } = useDateRange();
  if (!dateRange.from) return null;
  return (
    <DateRangePicker
      from={dateRange.from}
      to={dateRange.to}
      onChange={(f, t) => setDateRange(f, t)}
      earliest={dateExtent.earliest}
      latest={dateExtent.latest}
    />
  );
}

export default function DashboardLayout({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const overlayRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();
  const currentTab = getCurrentTab(pathname);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/'); return; }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (data) setProfile(data);
      setLoading(false);
    }
    load();
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile menu open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!profile || loading) return;
    const allowed = getAllowedTabs(profile);
    if (allowed !== null && !allowed.includes(currentTab)) {
      router.replace('/dashboard/' + allowed[0]);
    }
  }, [profile, loading, currentTab]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const navigateTo = (tabId) => {
    router.push(tabId === 'overview' ? '/dashboard' : '/dashboard/' + tabId);
    setMobileMenuOpen(false);
  };

  const goHome = () => {
    const allowed = getAllowedTabs(profile);
    if (allowed !== null) {
      navigateTo(allowed[0]);
    } else {
      navigateTo('overview');
    }
  };

  const isPending = profile?.role === 'pending';

  const visibleTabs = profile
    ? ALL_TABS.filter(t => {
        if (isPending) return false;
        if (t.ownerOnly && profile.role !== 'owner' && profile.role !== 'finance') return false;
        const allowed = getAllowedTabs(profile);
        if (allowed !== null) return allowed.includes(t.id);
        return canAccessTab(profile, t.id);
      })
    : [];

  const showDatePicker = !['admin', 'finance', 'customers', 'brand-analysis', 'warehouse', 'warehouse-settings'].includes(currentTab);

  if (loading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid var(--border)', borderTop:'3px solid var(--accent)', borderRadius:'50%' }} />
      </div>
    );
  }

  if (isPending) {
    return (
      <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, padding:40, textAlign:'center', maxWidth:420 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>⏳</div>
          <h2 style={{ margin:'0 0 8px', fontSize:20, fontWeight:700 }}>Menunggu Persetujuan</h2>
          <p style={{ margin:'0 0 24px', color:'var(--dim)', fontSize:14, lineHeight:1.6 }}>
            Akun Anda telah terdaftar. Silakan hubungi Owner untuk mengaktifkan akses dashboard.
          </p>
          <button onClick={handleLogout} style={{ padding:'10px 24px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--dim)', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            Keluar
          </button>
        </div>
      </div>
    );
  }

  const bmAllowed = getAllowedTabs(profile);
  if (bmAllowed !== null && !bmAllowed.includes(currentTab)) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid var(--border)', borderTop:'3px solid var(--accent)', borderRadius:'50%' }} />
      </div>
    );
  }

  const sidebarW = sidebarCollapsed ? 64 : 220;

  // ── Shared sidebar content (used by both desktop and mobile) ──
  function SidebarNav({ isMobile = false }) {
    return (
      <>
        {/* Nav Items */}
        <nav style={{ flex:1, padding:'8px 8px', display:'flex', flexDirection:'column', gap:2 }}>
          {visibleTabs.map(t => {
            const active = currentTab === t.id;
            const collapsed = !isMobile && sidebarCollapsed;
            return (
              <button
                key={t.id}
                onClick={() => navigateTo(t.id)}
                title={collapsed ? t.label : undefined}
                style={{
                  display:'flex',
                  alignItems:'center',
                  gap:12,
                  padding: collapsed ? '10px 0' : '10px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius:8,
                  border:'none',
                  cursor:'pointer',
                  fontSize:14,
                  fontWeight: active ? 600 : 500,
                  background: active ? 'var(--sidebar-active)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  transition:'all 0.15s ease',
                  whiteSpace:'nowrap',
                  width:'100%',
                }}
              >
                <TabIcon id={t.id} size={20} />
                {(isMobile || !sidebarCollapsed) && <span>{t.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Logout at bottom */}
        <div style={{ padding:'12px 8px', borderTop:'1px solid var(--border)' }}>
          <button
            onClick={handleLogout}
            style={{
              display:'flex', alignItems:'center', gap:12, width:'100%',
              padding: (!isMobile && sidebarCollapsed) ? '10px 0' : '10px 12px',
              justifyContent: (!isMobile && sidebarCollapsed) ? 'center' : 'flex-start',
              borderRadius:8, border:'none', cursor:'pointer',
              background:'transparent', color:'var(--dim)', fontSize:14, fontWeight:500,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {(isMobile || !sidebarCollapsed) && <span>Keluar</span>}
          </button>
        </div>
      </>
    );
  }

  return (
    <DateRangeProvider>
      <ActiveBrandsProvider>
      <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex' }}>

        {/* ═══ DESKTOP SIDEBAR ═══ */}
        <aside className="desktop-sidebar" style={{
          width: sidebarW,
          minHeight:'100vh',
          background:'var(--sidebar-bg)',
          borderRight:'1px solid var(--border)',
          display:'flex',
          flexDirection:'column',
          position:'fixed',
          top:0,
          left:0,
          zIndex:45,
          transition:'width 0.2s ease',
        }}>
          {/* Logo */}
          <div style={{
            padding: sidebarCollapsed ? '16px 0' : '16px 16px',
            borderBottom:'1px solid var(--border)',
            display:'flex',
            alignItems:'center',
            justifyContent: sidebarCollapsed ? 'center' : 'space-between',
            gap:10,
            cursor:'pointer',
            minHeight:57,
          }}>
            <div onClick={goHome} style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{
                width:32, height:32, borderRadius:8, flexShrink:0,
                background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:15, fontWeight:800, color:'#fff',
              }}>R</div>
              {!sidebarCollapsed && (
                <span style={{ fontSize:16, fontWeight:700, color:'var(--text)', whiteSpace:'nowrap' }}>Roove BI</span>
              )}
            </div>
            {!sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(true)} style={{
                background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:4,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>
                </svg>
              </button>
            )}
            {sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(false)} style={{
                border:'1px solid var(--border)', cursor:'pointer', color:'var(--text-muted)',
                padding:4, position:'absolute', right:-12, top:16,
                background:'var(--card)', borderRadius:'50%',
                width:24, height:24, display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>
                </svg>
              </button>
            )}
          </div>

          <SidebarNav isMobile={false} />
        </aside>

        {/* ═══ MOBILE OVERLAY + SLIDE-OUT SIDEBAR ═══ */}
        {mobileMenuOpen && (
          <div
            ref={overlayRef}
            onClick={(e) => { if (e.target === overlayRef.current) setMobileMenuOpen(false); }}
            className="mobile-overlay"
            style={{
              position:'fixed', top:0, left:0, right:0, bottom:0,
              background:'var(--overlay-bg)',
              zIndex:100,
              backdropFilter:'blur(2px)',
            }}
          >
            <aside style={{
              width:260,
              height:'100%',
              background:'var(--sidebar-bg)',
              borderRight:'1px solid var(--border)',
              display:'flex',
              flexDirection:'column',
              animation:'slideIn 0.2s ease-out',
            }}>
              {/* Mobile sidebar header */}
              <div style={{
                padding:'16px 16px',
                borderBottom:'1px solid var(--border)',
                display:'flex',
                alignItems:'center',
                justifyContent:'space-between',
                minHeight:57,
              }}>
                <div onClick={goHome} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
                  <div style={{
                    width:32, height:32, borderRadius:8,
                    background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:15, fontWeight:800, color:'#fff',
                  }}>R</div>
                  <span style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>Roove BI</span>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} style={{
                  background:'none', border:'none', cursor:'pointer', color:'var(--dim)', padding:4,
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <SidebarNav isMobile={true} />
            </aside>
          </div>
        )}

        {/* ═══ MAIN CONTENT ═══ */}
        <div className="main-content-area" style={{
          flex:1,
          minWidth:0,
          marginLeft: sidebarW,
          transition:'margin-left 0.2s ease',
          display:'flex',
          flexDirection:'column',
          minHeight:'100vh',
        }}>
          {/* Top Bar */}
          <header style={{
            padding:'10px 16px',
            borderBottom:'1px solid var(--border)',
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            background:'var(--header-bg)',
            backdropFilter:'blur(8px)',
            position:'sticky',
            top:0,
            zIndex:40,
            minHeight:49,
            gap:8,
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              {/* Hamburger - mobile only */}
              <button className="mobile-hamburger" onClick={() => setMobileMenuOpen(true)} style={{
                display:'none', /* shown via CSS on mobile */
                background:'none', border:'none', cursor:'pointer', color:'var(--text-secondary)', padding:4,
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)' }}>
                {visibleTabs.find(t => t.id === currentTab)?.label || 'Dashboard'}
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <RefreshViewsButton />
              {showDatePicker && <HeaderDatePicker />}
              <ThemeToggle />
              <div className="desktop-sidebar" style={{ fontSize:11, color:'var(--text-muted)', fontWeight:500 }}>
                {profile?.full_name || profile?.email}
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="dashboard-content" style={{ padding:'16px 20px', maxWidth:1400, width:'100%', overflowX:'hidden' }}>
            {children}
          </main>
        </div>
      </div>
      </ActiveBrandsProvider>
    </DateRangeProvider>
  );
}

function TabIcon({ id, size = 18 }) {
  const s = { width: size, height: size, flexShrink: 0 };
  switch(id) {
    case 'overview': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
    case 'products': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>;
    case 'channels': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
    case 'marketing': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case 'customers': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;
    case 'brand-analysis': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M2 12h20"/><path d="M12 2v20"/><path d="M7 7h0"/><path d="M17 7h0"/><path d="M7 17h0"/><path d="M17 17h0"/></svg>;
    case 'finance': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>;
    case 'warehouse': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect x="6" y="10" width="12" height="12"/></svg>;
    case 'warehouse-settings': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>;
    case 'waba-management': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>;
    case 'ppic': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>;
    case 'business-settings': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18Z"/><path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/><path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>;
    case 'admin': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    default: return null;
  }
}
