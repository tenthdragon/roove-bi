// @ts-nocheck
// v7 - added brand-analysis tab
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { ALL_TABS, canAccessTab } from '@/lib/utils';
import { DateRangeProvider, useDateRange } from '@/lib/DateRangeContext';
import DateRangePicker from '@/components/DateRangePicker';
import { ActiveBrandsProvider } from '@/lib/ActiveBrandsContext';

function getCurrentTab(path) {
  const seg = path.replace('/dashboard', '').replace(/^\//, '');
  return seg || 'overview';
}

function getAllowedTabs(prof) {
  if (!prof) return [];
  if (prof.role === 'brand_manager') {
    return prof.allowed_tabs && prof.allowed_tabs.length > 0 ? prof.allowed_tabs : ['marketing'];
  }
  return null;
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
  const supabase = createClient();
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

  const showDatePicker = !['admin', 'finance', 'customers', 'brand-analysis'].includes(currentTab);

  if (loading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0b1121' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%' }} />
      </div>
    );
  }

  if (isPending) {
    return (
      <div style={{ minHeight:'100vh', background:'#0b1121', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:16, padding:40, textAlign:'center', maxWidth:420 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>⏳</div>
          <h2 style={{ margin:'0 0 8px', fontSize:20, fontWeight:700 }}>Menunggu Persetujuan</h2>
          <p style={{ margin:'0 0 24px', color:'#64748b', fontSize:14, lineHeight:1.6 }}>
            Akun Anda telah terdaftar. Silakan hubungi Owner untuk mengaktifkan akses dashboard.
          </p>
          <button onClick={handleLogout} style={{ padding:'10px 24px', borderRadius:8, border:'1px solid #1a2744', background:'transparent', color:'#64748b', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            Keluar
          </button>
        </div>
      </div>
    );
  }

  const bmAllowed = getAllowedTabs(profile);
  if (bmAllowed !== null && !bmAllowed.includes(currentTab)) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0b1121' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%' }} />
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
                  background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
                  color: active ? '#60a5fa' : '#94a3b8',
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
        <div style={{ padding:'12px 8px', borderTop:'1px solid #1a2744' }}>
          <button
            onClick={handleLogout}
            style={{
              display:'flex', alignItems:'center', gap:12, width:'100%',
              padding: (!isMobile && sidebarCollapsed) ? '10px 0' : '10px 12px',
              justifyContent: (!isMobile && sidebarCollapsed) ? 'center' : 'flex-start',
              borderRadius:8, border:'none', cursor:'pointer',
              background:'transparent', color:'#64748b', fontSize:14, fontWeight:500,
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
      <div style={{ minHeight:'100vh', background:'#0b1121', display:'flex' }}>

        {/* ═══ DESKTOP SIDEBAR ═══ */}
        <aside className="desktop-sidebar" style={{
          width: sidebarW,
          minHeight:'100vh',
          background:'linear-gradient(180deg, #0f172a 0%, #111a2e 100%)',
          borderRight:'1px solid #1a2744',
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
            borderBottom:'1px solid #1a2744',
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
                <span style={{ fontSize:16, fontWeight:700, color:'#e2e8f0', whiteSpace:'nowrap' }}>Roove BI</span>
              )}
            </div>
            {!sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(true)} style={{
                background:'none', border:'none', cursor:'pointer', color:'#475569', padding:4,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>
                </svg>
              </button>
            )}
            {sidebarCollapsed && (
              <button onClick={() => setSidebarCollapsed(false)} style={{
                border:'1px solid #1a2744', cursor:'pointer', color:'#475569',
                padding:4, position:'absolute', right:-12, top:16,
                background:'#111a2e', borderRadius:'50%',
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
              background:'rgba(0,0,0,0.6)',
              zIndex:100,
              backdropFilter:'blur(2px)',
            }}
          >
            <aside style={{
              width:260,
              height:'100%',
              background:'linear-gradient(180deg, #0f172a 0%, #111a2e 100%)',
              borderRight:'1px solid #1a2744',
              display:'flex',
              flexDirection:'column',
              animation:'slideIn 0.2s ease-out',
            }}>
              {/* Mobile sidebar header */}
              <div style={{
                padding:'16px 16px',
                borderBottom:'1px solid #1a2744',
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
                  <span style={{ fontSize:16, fontWeight:700, color:'#e2e8f0' }}>Roove BI</span>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} style={{
                  background:'none', border:'none', cursor:'pointer', color:'#64748b', padding:4,
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
          marginLeft: sidebarW,
          transition:'margin-left 0.2s ease',
          display:'flex',
          flexDirection:'column',
          minHeight:'100vh',
        }}>
          {/* Top Bar */}
          <header style={{
            padding:'10px 16px',
            borderBottom:'1px solid #1a2744',
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            background:'rgba(11,17,33,0.8)',
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
                background:'none', border:'none', cursor:'pointer', color:'#94a3b8', padding:4,
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <div style={{ fontSize:14, fontWeight:600, color:'#94a3b8' }}>
                {visibleTabs.find(t => t.id === currentTab)?.label || 'Dashboard'}
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
              {showDatePicker && <HeaderDatePicker />}
              <div className="desktop-sidebar" style={{ fontSize:11, color:'#475569', fontWeight:500 }}>
                {profile?.full_name || profile?.email}
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="dashboard-content" style={{ padding:'16px 20px', maxWidth:1400, width:'100%' }}>
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
    case 'admin': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    default: return null;
  }
}
