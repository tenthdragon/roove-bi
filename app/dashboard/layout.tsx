// @ts-nocheck
// v7 - added brand-analysis tab
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSupabase } from '@/lib/supabase-browser';
import { ALL_TABS, canAccessTab } from '@/lib/utils';
import { PermissionsProvider, usePermissions } from '@/lib/PermissionsContext';
import { DateRangeProvider, useDateRange } from '@/lib/DateRangeContext';
import DateRangePicker from '@/components/DateRangePicker';
import { ActiveBrandsProvider } from '@/lib/ActiveBrandsContext';
import ThemeToggle from '@/components/ThemeToggle';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import DashboardFrame from '@/components/DashboardFrame';
import DashboardNavigation from '@/components/DashboardNavigation';
import { useSupabaseSessionReady } from '@/lib/useSupabaseSessionReady';
import { WorkspaceProvider } from '@/lib/WorkspaceContext';
import { isWorkspaceModuleEnabled } from '@/lib/workspaces';
import { canRoleAccessPermission } from '@/lib/role-access';
import { profileThemePreference } from '@/lib/theme-preference';

function getCurrentTab(path) {
  const seg = path.replace('/dashboard', '').replace(/^\//, '');
  return seg || 'overview';
}

function getTabPath(tabId) {
  return tabId === 'overview' ? '/dashboard' : '/dashboard/' + tabId;
}

function hasAdminAreaAccess(role, permissions) {
  if (role === 'owner') return true;
  if (canRoleAccessPermission(role, permissions, 'tab:admin')) return true;

  for (const permission of permissions) {
    if (
      permission.startsWith('admin:')
      && canRoleAccessPermission(role, permissions, permission)
    ) return true;
  }

  return false;
}

function canAccessLayoutTab(role, tab, permissions) {
  // Sales Channel Analysis inherits its parent Sales Channel permission.
  if (tab.id === 'sales-channel-analysis') return canAccessTab(role, 'channels', permissions);
  // Shopee Details normally inherits Marketing Channel, while the dedicated
  // Shopee reviewer can receive access to this child page without the parent.
  if (tab.id === 'shopee-details') {
    return canAccessTab(role, 'marketing', permissions)
      || canAccessTab(role, 'shopee-details', permissions);
  }
  if (tab.id === 'admin') return hasAdminAreaAccess(role, permissions);
  if (tab.ownerOnly && role !== 'owner') return false;
  return canAccessTab(role, tab.id, permissions);
}

function getOrderedAccessibleTabIds(role, permissions) {
  const ids: string[] = [];

  for (const tab of ALL_TABS) {
    if (canAccessLayoutTab(role, tab, permissions)) ids.push(tab.id);
    if (tab.children) {
      for (const child of tab.children) {
        if (canAccessLayoutTab(role, child, permissions)) ids.push(child.id);
      }
    }
  }

  return ids;
}

function buildVisibleTabs(role, permissions) {
  return ALL_TABS.map(tab => {
    const parentVisible = canAccessLayoutTab(role, tab, permissions);
    const visibleChildren = tab.children?.filter(child => canAccessLayoutTab(role, child, permissions)) ?? [];

    if (tab.children) {
      if (!parentVisible && visibleChildren.length === 0) return null;
      return { ...tab, children: visibleChildren };
    }

    if (!parentVisible) return null;
    return tab;
  }).filter(Boolean);
}

function findTabLabel(tabs, targetId) {
  for (const tab of tabs) {
    if (tab.id === targetId) return tab.label;
    if (tab.children?.length) {
      const childLabel = findTabLabel(tab.children, targetId);
      if (childLabel) return childLabel;
    }
  }
  return null;
}

// getAllowedTabs is now driven by role_permissions — see usePermissions() hook below

function RefreshViewsButton({
  canSyncSheets,
  canSyncMeta,
}: {
  canSyncSheets: boolean;
  canSyncMeta: boolean;
}) {
  const { dateRange } = useDateRange();
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
    if (!canSyncSheets && !canSyncMeta) return;

    setStatus('loading');
    setShowDetail(true);
    setSteps({
      sheets: canSyncSheets ? 'running' : 'skipped',
      meta: canSyncMeta ? 'running' : 'skipped',
    });
    setStepMessages({ sheets: '', meta: '' });

    let sheetsOk = false;
    let metaOk = false;
    const metaParams = new URLSearchParams();

    if (dateRange.from) metaParams.set('date_start', dateRange.from);
    if (dateRange.to) metaParams.set('date_end', dateRange.to);

    const metaUrl = metaParams.toString()
      ? `/api/meta-sync?${metaParams.toString()}`
      : '/api/meta-sync';

    // Step 1: Run Google Sheets sync & Meta Ads sync in parallel
    const [sheetsRes, metaRes] = await Promise.allSettled([
      canSyncSheets
        ? fetch('/api/sync', { method: 'POST' }).then(async r => {
            const d = await r.json();
            return { ok: r.ok, data: d };
          })
        : Promise.resolve({ ok: true, data: { skipped: true } }),
      canSyncMeta
        ? fetch(metaUrl, { method: 'POST' }).then(async r => {
            const d = await r.json();
            return { ok: r.ok, data: d };
          })
        : Promise.resolve({ ok: true, data: { skipped: true } }),
    ]);

    // Process Google Sheets result
    if (sheetsRes.status === 'fulfilled') {
      const { ok, data } = sheetsRes.value;
      if (data.skipped) {
        setSteps(s => ({ ...s, sheets: 'skipped' }));
        setStepMessages(s => ({ ...s, sheets: 'Tidak diizinkan' }));
      } else if (ok && !data.error) {
        sheetsOk = true;
        setSteps(s => ({ ...s, sheets: 'success' }));
        setStepMessages(s => ({
          ...s,
          sheets: data.queued ? 'Masuk antrean' : (data.message || 'Dimulai'),
        }));
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
      if (data.skipped) {
        setSteps(s => ({ ...s, meta: 'skipped' }));
        setStepMessages(s => ({ ...s, meta: 'Tidak diizinkan' }));
      } else if (ok && !data.error) {
        metaOk = true;
        setSteps(s => ({ ...s, meta: 'success' }));
        setStepMessages(s => ({
          ...s,
          meta: data.queued ? 'Masuk antrean' : (data.message || 'Dimulai'),
        }));
      } else {
        setSteps(s => ({ ...s, meta: 'error' }));
        setStepMessages(s => ({ ...s, meta: data.error || 'Gagal' }));
      }
    } else {
      setSteps(s => ({ ...s, meta: 'error' }));
      setStepMessages(s => ({ ...s, meta: 'Network error' }));
    }

    // Done — the heavy syncs now continue in the queue worker.
    setStatus(sheetsOk || metaOk ? 'success' : 'error');
    if (sheetsOk || metaOk) {
      setTimeout(() => {
        setStatus('idle');
        setShowDetail(false);
      }, 1800);
    } else {
      setTimeout(() => {
        setStatus('idle');
        setShowDetail(false);
      }, 4000);
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
      case 'running': return 'var(--accent)';
      case 'success': return 'var(--green)';
      case 'error': return 'var(--red)';
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--green)' }}>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    error: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--red)' }}>
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
  };

  return (
    <div style={{ position: 'relative' }} ref={detailRef}>
      <button
        onClick={handleRefresh}
        disabled={status === 'loading'}
        title="Masukkan sync Google Sheets dan Meta ke antrean"
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
  const [workspaceBootstrap, setWorkspaceBootstrap] = useState(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();
  const { ready: authReady, hasSession } = useSupabaseSessionReady();
  const currentTab = getCurrentTab(pathname);

  useEffect(() => {
    if (!authReady) return;

    if (!hasSession) {
      router.replace('/');
      return;
    }

    let cancelled = false;

    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    async function loadLegacyProfileWithRetry(userId: string) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const directResult = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (directResult.data) return directResult;

        // Workspace RLS must not strand an otherwise valid authenticated
        // session. The RPC can only return the profile identified by auth.uid().
        const rpcResult = await supabase
          .rpc('get_my_dashboard_profile')
          .maybeSingle();

        if (rpcResult.data) return rpcResult;
        if (directResult.error || rpcResult.error) {
          return {
            data: null,
            error: directResult.error || rpcResult.error,
          };
        }
        if (attempt < 2) await wait(250 * (attempt + 1));
      }

      return { data: null, error: null };
    }

    async function load() {
      setLoading(true);
      setAccessError('');

      let serverPayload: any = {};
      let serverResponse: Response | null = null;
      try {
        serverResponse = await fetch('/api/auth/profile', {
          cache: 'no-store',
        });
        serverPayload = await serverResponse.json().catch(() => ({}));
      } catch (error) {
        console.warn('[dashboard-layout] bundled bootstrap request failed', error);
      }

      if (cancelled) return;

      if (serverResponse?.status === 401) {
        router.replace('/');
        return;
      }

      let data = serverResponse?.ok ? serverPayload.profile : null;
      let profileError: any = null;
      let fallbackUserId: string | null = null;

      // Compatibility fallback for transient API failures and rolling deploys.
      // The normal path above returns profile, workspace and permissions in one
      // request; these client-side lookups are only used if that bundle is not
      // available.
      if (!data) {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (cancelled) return;
        if (userError || !user) {
          router.replace('/');
          return;
        }

        fallbackUserId = user.id;
        const legacyProfile = await loadLegacyProfileWithRetry(user.id);
        data = legacyProfile.data;
        profileError = legacyProfile.error;
      }

      if (cancelled) return;

      if (profileError || !data) {
        console.warn('[dashboard-layout] profile lookup failed', {
          userId: fallbackUserId,
          message: profileError?.message ?? null,
          code: (profileError as any)?.code ?? null,
        });
        setAccessError('Profil dashboard tidak ditemukan atau gagal dimuat. Silakan hubungi owner.');
        setLoading(false);
        return;
      }

      setProfile(data);
      let workspaceData = serverPayload.workspaceBootstrap || null;
      let bundledPermissions = Array.isArray(serverPayload.permissions)
        ? serverPayload.permissions
        : null;

      if (data.role !== 'pending') {
        if (!workspaceData) {
          const workspaceResponse = await fetch('/api/workspaces', {
            cache: 'no-store',
          });
          workspaceData = await workspaceResponse.json().catch(() => ({}));
          bundledPermissions = null;

          if (!workspaceResponse.ok || workspaceData.error) {
            setAccessError(
              workspaceData.error || serverPayload.error ||
                'Workspace dashboard gagal dimuat. Silakan hubungi owner.',
            );
            setLoading(false);
            return;
          }
        }

        if (cancelled) return;
        setWorkspaceBootstrap(workspaceData);
      }

      const membershipRole = workspaceData?.activeWorkspace?.membershipRole;
      const effectiveRole =
        data.role === 'owner' || membershipRole === 'workspace_owner'
          ? 'owner'
          : membershipRole || data.role;

      if (effectiveRole !== 'owner' && data.role !== 'pending') {
        if (bundledPermissions) {
          setPermissions(new Set(bundledPermissions));
        } else {
          const { data: perms, error: permsError } = await supabase
              .from('workspace_role_permissions')
              .select('permission_key')
              .eq('workspace_id', workspaceData.activeWorkspace.id)
              .eq('role', effectiveRole);

          if (cancelled) return;

          if (permsError) {
            setAccessError('Permission dashboard gagal dimuat. Silakan coba lagi atau hubungi owner.');
            setLoading(false);
            return;
          }

          setPermissions(new Set((perms ?? []).map((r: any) => r.permission_key)));
        }
      }
      setLoading(false);
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [authReady, hasSession, router, supabase]);

  const accessRole = useMemo(() => {
    if (!profile) return null;
    if (
      profile.role === 'owner' ||
      workspaceBootstrap?.activeWorkspace?.membershipRole === 'workspace_owner'
    ) {
      return 'owner';
    }
    return workspaceBootstrap?.activeWorkspace?.membershipRole || profile.role;
  }, [profile, workspaceBootstrap]);

  const accessibleTabIds = useMemo(() => {
    if (!profile || accessRole === 'pending') return [];
    const ids = getOrderedAccessibleTabIds(accessRole, permissions);
    const workspace = workspaceBootstrap?.activeWorkspace;
    return workspace
      ? ids.filter((tabId) => isWorkspaceModuleEnabled(workspace, tabId))
      : ids;
  }, [profile, accessRole, permissions, workspaceBootstrap]);

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
    if (accessRole === 'pending' || accessRole === 'owner') return;
    if (accessibleTabIds.length === 0) return;
    if (!accessibleTabIds.includes(currentTab)) {
      router.replace(getTabPath(accessibleTabIds[0]));
    }
  }, [profile, accessRole, loading, currentTab, accessibleTabIds, router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const navigateTo = (tabId) => {
    router.push(getTabPath(tabId));
    setMobileMenuOpen(false);
  };

  const goHome = () => {
    if (accessRole === 'owner') { navigateTo('overview'); return; }
    navigateTo(accessibleTabIds[0] || 'overview');
  };

  const isPending = accessRole === 'pending';

  let visibleTabs = profile && !isPending
    ? buildVisibleTabs(accessRole, permissions)
    : [];
  if (workspaceBootstrap?.activeWorkspace) {
    const workspace = workspaceBootstrap.activeWorkspace;
    visibleTabs = visibleTabs
      .map((tab) => {
        const workspaceParentEnabled = isWorkspaceModuleEnabled(workspace, tab.id);
        const children = tab.children?.filter((child) =>
          isWorkspaceModuleEnabled(workspace, child.id),
        );

        if (tab.children) {
          if (!workspaceParentEnabled && (children?.length || 0) === 0) return null;
          return { ...tab, children, workspaceParentEnabled };
        }

        return workspaceParentEnabled
          ? { ...tab, workspaceParentEnabled }
          : null;
      })
      .filter(Boolean);
  }

  const showDatePicker = !['admin', 'finance', 'customers', 'brand-analysis', 'warehouse', 'warehouse-settings', 'financial-report', 'cashflow', 'financial-settings', 'fixed-costs', 'marketplace-intake', 'growth-work'].includes(currentTab);
  const canSyncSheets = canRoleAccessPermission(accessRole, permissions, 'admin:daily');
  const canSyncMeta = canRoleAccessPermission(accessRole, permissions, 'admin:meta');
  const showRefreshButton = canSyncSheets || canSyncMeta;

  if (loading) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid var(--border)', borderTop:'3px solid var(--accent)', borderRadius:'50%' }} />
      </div>
    );
  }

  if (accessError || (!isPending && accessRole !== 'owner' && accessibleTabIds.length === 0)) {
    return (
      <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:16, padding:40, textAlign:'center', maxWidth:460 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
          <h2 style={{ margin:'0 0 8px', fontSize:20, fontWeight:700 }}>Akses Dashboard Tidak Tersedia</h2>
          <p style={{ margin:'0 0 24px', color:'var(--dim)', fontSize:14, lineHeight:1.6 }}>
            {accessError || 'Akun ini belum memiliki permission tab dashboard. Silakan hubungi owner untuk mengaktifkan akses.'}
          </p>
          <button onClick={handleLogout} style={{ padding:'10px 24px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--dim)', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            Logout
          </button>
        </div>
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
            Logout
          </button>
        </div>
      </div>
    );
  }

  // Do not mount an unauthorized page while the client-side redirect is in
  // flight. Server actions remain permission-gated, and this also prevents a
  // restricted reviewer from briefly rendering another dashboard screen.
  if (
    accessRole !== 'owner'
    && accessibleTabIds.length > 0
    && !accessibleTabIds.includes(currentTab)
  ) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid var(--border)', borderTop:'3px solid var(--accent)', borderRadius:'50%' }} />
      </div>
    );
  }



  if (!workspaceBootstrap) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
        <div style={{ color:'var(--dim)', fontSize:13 }}>Workspace belum tersedia.</div>
      </div>
    );
  }

  return (
    <WorkspaceProvider initial={workspaceBootstrap}>
    <PermissionsProvider role={accessRole} permissions={permissions}>
    <DateRangeProvider>
      <ActiveBrandsProvider>
      <DashboardFrame
        workspaceName={workspaceBootstrap.activeWorkspace.name}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        onHome={goHome}
        renderNavigation={(isMobile) => (
          <DashboardNavigation
            tabs={visibleTabs}
            currentTab={currentTab}
            isMobile={isMobile}
            sidebarCollapsed={sidebarCollapsed}
            expandedMenus={expandedMenus}
            canAccess={(tab) => tab.workspaceParentEnabled !== false && canAccessLayoutTab(accessRole, tab, permissions)}
            navigateTo={navigateTo}
            setSidebarCollapsed={setSidebarCollapsed}
            setExpandedMenus={setExpandedMenus}
            onLogout={handleLogout}
          />
        )}
        headerActions={<>
          <WorkspaceSwitcher />
          {showRefreshButton && <RefreshViewsButton canSyncSheets={canSyncSheets} canSyncMeta={canSyncMeta} />}
          {showDatePicker && <HeaderDatePicker />}
          <ThemeToggle
            preference={profileThemePreference(profile)}
            onPreferenceSaved={(themePreference) => setProfile((current: any) => (current ? { ...current, theme_preference: themePreference } : current))}
          />
          <div className="desktop-sidebar" style={{ fontSize:11, color:'var(--text-muted)', fontWeight:500 }}>
            {profile?.full_name || profile?.email}
          </div>
        </>}
      >
        {children}
      </DashboardFrame>
      </ActiveBrandsProvider>
    </DateRangeProvider>
    </PermissionsProvider>
    </WorkspaceProvider>
  );
}
