// @ts-nocheck test
// v3 - brand manager redirect fix
'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { ALL_TABS, canAccessTab } from '@/lib/utils';

function getCurrentTab(path) {
  const seg = path.replace('/dashboard', '').replace(/^\//, '');
  return seg || 'overview';
}

function getAllowedTabs(prof) {
  if (!prof) return [];
  if (prof.role === 'brand_manager') {
    return prof.allowed_tabs && prof.allowed_tabs.length > 0 ? prof.allowed_tabs : ['marketing'];
  }
  return null; // null means all tabs allowed
}

export default function DashboardLayout({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
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

  // CRITICAL: Redirect brand_manager to marketing immediately
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

  const visibleTabs = profile ? ALL_TABS.filter(t => {
    if (isPending) return false;
    if (t.ownerOnly && profile.role !== 'owner') return false;
    const allowed = getAllowedTabs(profile);
    if (allowed !== null) return allowed.includes(t.id);
    return canAccessTab(profile, t.id);
  }) : [];

  // Loading state
  if (loading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0b1121' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%' }} />
      </div>
    );
  }

  // Pending approval
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

  // Brand manager on wrong page - show spinner while redirecting
  const bmAllowed = getAllowedTabs(profile);
  if (bmAllowed !== null && !bmAllowed.includes(currentTab)) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0b1121' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%' }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight:'100vh', background:'#0b1121' }}>
      {/* HEADER */}
      <header style={{ background:'linear-gradient(135deg,#0f172a,#1e1b4b)', borderBottom:'1px solid #1a2744', padding:'12px 16px', position:'sticky', top:0, zIndex:40 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', maxWidth:1400, margin:'0 auto' }}>
          <div onClick={goHome} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', flexShrink:0 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:'linear-gradient(135deg,#3b82f6,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'#fff', flexShrink:0 }}>R</div>
            <h1 style={{ margin:0, fontSize:16, fontWeight:700, whiteSpace:'nowrap' }}>Roove BI</h1>
          </div>
          <nav className="desktop-nav" style={{ display:'flex', gap:2, background:'#0f172a', borderRadius:10, padding:3, border:'1px solid #1a2744' }}>
            {visibleTabs.map(t => (
              <button key={t.id} onClick={() => navigateTo(t.id)} style={{ padding:'7px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, background:currentTab===t.id?'#3b82f6':'transparent', color:currentTab===t.id?'#fff':'#64748b', whiteSpace:'nowrap' }}>{t.label}</button>
            ))}
          </nav>
          <button onClick={handleLogout} style={{ padding:'6px 14px', borderRadius:7, border:'1px solid #1a2744', background:'transparent', color:'#64748b', fontSize:12, cursor:'pointer', fontWeight:500, flexShrink:0, whiteSpace:'nowrap' }}>Keluar</button>
        </div>
      </header>

      {/* CONTENT */}
      <main className="dashboard-content" style={{ padding:'16px', maxWidth:1400, margin:'0 auto' }}>{children}</main>

      {/* MOBILE BOTTOM NAV */}
      <nav className="mobile-nav" style={{ display:'none', position:'fixed', bottom:0, left:0, right:0, background:'#111a2e', borderTop:'1px solid #1a2744', padding:'6px 8px', paddingBottom:'max(6px, env(safe-area-inset-bottom))', zIndex:50, justifyContent:'space-around' }}>
        {visibleTabs.map(t => (
          <button key={t.id} onClick={() => navigateTo(t.id)} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:'6px 8px', borderRadius:8, border:'none', cursor:'pointer', background:currentTab===t.id?'rgba(59,130,246,0.15)':'transparent', color:currentTab===t.id?'#3b82f6':'#64748b', fontSize:10, fontWeight:600, minWidth:48 }}>
            <TabIcon id={t.id} />{t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function TabIcon({ id }) {
  const s = { width:18, height:18 };
  switch(id) {
    case 'overview': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>;
    case 'products': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>;
    case 'channels': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
    case 'marketing': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case 'admin': return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    default: return null;
  }
}
