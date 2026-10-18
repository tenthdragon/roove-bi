"use client";

import type { Dispatch, SetStateAction } from "react";
import type { TabDef } from "@/lib/utils";

type Props = {
  tabs: TabDef[];
  currentTab: string;
  isMobile?: boolean;
  sidebarCollapsed: boolean;
  expandedMenus: Record<string, boolean>;
  canAccess: (tab: TabDef) => boolean;
  navigateTo: (id: string) => void;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  setExpandedMenus: Dispatch<SetStateAction<Record<string, boolean>>>;
  onLogout?: () => void;
  isUnavailable?: (tab: TabDef) => boolean;
};

export default function DashboardNavigation({
  tabs: visibleTabs,
  currentTab,
  isMobile = false,
  sidebarCollapsed,
  expandedMenus,
  canAccess,
  navigateTo,
  setSidebarCollapsed,
  setExpandedMenus,
  onLogout,
  isUnavailable = () => false,
}: Props) {
  // On mobile, flatten children into top-level items (no submenus)
  const flatTabs = isMobile
    ? visibleTabs.flatMap((t) => {
        const parentAccessible = canAccess(t);
        const parent = { ...t, children: undefined };
        const children =
          t.children?.map((c) => ({ ...c, group: t.group })) ?? [];
        return t.children?.length
          ? parentAccessible
            ? [parent, ...children]
            : children
          : [parent];
      })
    : visibleTabs;

  // Pre-compute group boundaries
  const tabsWithGroupInfo = flatTabs.map((t, idx) => {
    const prevGroup = idx > 0 ? flatTabs[idx - 1].group : null;
    const showGroupHeader = t.group && t.group !== prevGroup;
    const showSpacer = !t.group && prevGroup;
    return { ...t, showGroupHeader, showSpacer };
  });

  return (
    <>
      {/* Nav Items */}
      <nav
        style={{
          flex: 1,
          minHeight: 0,
          padding: "8px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {tabsWithGroupInfo.map((t, idx) => {
          const hasChildren = t.children && t.children.length > 0;
          const parentAccessible = canAccess(t);
          const active = currentTab === t.id;
          const childActive =
            hasChildren && t.children?.some((c) => currentTab === c.id);
          const isExpanded = expandedMenus[t.id] || childActive;
          const collapsed = !isMobile && sidebarCollapsed;

          return (
            <div key={t.id}>
              {t.showGroupHeader && !collapsed && (
                <div
                  style={{
                    padding: idx === 0 ? "4px 12px 6px" : "16px 12px 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--dim)",
                  }}
                >
                  {t.group}
                </div>
              )}
              {t.showSpacer && !collapsed && <div style={{ height: 16 }} />}
              <button
                onClick={() => {
                  if (hasChildren) {
                    if (collapsed && !isMobile && !parentAccessible) {
                      setSidebarCollapsed(false);
                      setExpandedMenus((prev) => ({ ...prev, [t.id]: true }));
                      return;
                    }

                    if (!collapsed) {
                      if (parentAccessible) {
                        navigateTo(t.id);
                      }
                      if (!isMobile) {
                        setExpandedMenus((prev) => ({
                          ...prev,
                          [t.id]: !prev[t.id] && !childActive,
                        }));
                      }
                      return;
                    }

                    if (parentAccessible) {
                      navigateTo(t.id);
                    }
                    return;
                  }

                  if (parentAccessible) {
                    navigateTo(t.id);
                  }
                }}
                disabled={isUnavailable(t)}
                title={
                  isUnavailable(t)
                    ? "Modul ini tidak dimuat dalam preview"
                    : collapsed
                      ? t.label
                      : undefined
                }
                aria-current={active ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: collapsed ? "10px 0" : "10px 12px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: active || childActive ? 600 : 500,
                  background: active ? "var(--sidebar-active)" : "transparent",
                  color:
                    active || childActive
                      ? "var(--accent)"
                      : "var(--text-secondary)",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                  width: "100%",
                }}
              >
                <TabIcon id={t.id} size={20} />
                {(isMobile || !sidebarCollapsed) && (
                  <>
                    <span style={{ flex: 1, textAlign: "left" }}>
                      {t.label}
                    </span>
                    {hasChildren && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                          transition: "transform 0.2s ease",
                          transform: isExpanded
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                          flexShrink: 0,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedMenus((prev) => ({
                            ...prev,
                            [t.id]: !isExpanded,
                          }));
                        }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    )}
                  </>
                )}
              </button>

              {/* Submenu children */}
              {hasChildren && isExpanded && !collapsed && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    marginTop: 2,
                  }}
                >
                  {t.children?.map((child) => {
                    const childIsActive = currentTab === child.id;
                    return (
                      <button
                        key={child.id}
                        disabled={isUnavailable(child)}
                        onClick={() => navigateTo(child.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 12px 8px 20px",
                          borderRadius: 6,
                          border: "none",
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: childIsActive ? 600 : 400,
                          background: childIsActive
                            ? "var(--sidebar-active)"
                            : "transparent",
                          color: childIsActive
                            ? "var(--accent)"
                            : "var(--text-secondary)",
                          transition: "all 0.15s ease",
                          whiteSpace: "nowrap",
                          width: "100%",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--dim)",
                            fontSize: 14,
                            marginRight: 2,
                          }}
                        >
                          ↳
                        </span>
                        <span>{child.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Logout at bottom */}
      <div style={{ padding: "12px 8px", flexShrink: 0 }}>
        <button
          disabled={!onLogout}
          onClick={onLogout}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            padding: !isMobile && sidebarCollapsed ? "10px 0" : "10px 12px",
            justifyContent:
              !isMobile && sidebarCollapsed ? "center" : "flex-start",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "transparent",
            color: "var(--dim)",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          {(isMobile || !sidebarCollapsed) && <span>Logout</span>}
        </button>
      </div>
    </>
  );
}

function TabIcon({ id, size = 18 }: { id: string; size?: number }) {
  const s = { width: size, height: size, style: { flexShrink: 0 } };
  switch (id) {
    case "overview":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case "sales-channel-analysis":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="3 17 9 11 13 15 21 7" />
          <polyline points="15 7 21 7 21 13" />
        </svg>
      );
    case "products":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        </svg>
      );
    case "channels":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      );
    case "marketing":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      );
    case "customers":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "brand-analysis":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="2" y="2" width="20" height="20" rx="2" />
          <path d="M2 12h20" />
          <path d="M12 2v20" />
          <path d="M7 7h0" />
          <path d="M17 7h0" />
          <path d="M7 17h0" />
          <path d="M17 17h0" />
        </svg>
      );
    case "finance":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
        </svg>
      );
    case "warehouse":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 8.35V20a2 2 0 01-2 2H4a2 2 0 01-2-2V8.35A2 2 0 013.26 6.5l8-3.2a2 2 0 011.48 0l8 3.2A2 2 0 0122 8.35z" />
          <path d="M6 18h12" />
          <path d="M6 14h12" />
          <rect x="6" y="10" width="12" height="12" />
        </svg>
      );
    case "warehouse-settings":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case "waba-management":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
        </svg>
      );
    case "growth-work":
    case "ppic":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      );
    case "marketplace-intake":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 3V7a2 2 0 0 1 2-2z" />
          <path d="M8 10h8" />
          <path d="M8 14h5" />
        </svg>
      );
    case "business-settings":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18Z" />
          <path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2" />
          <path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
          <path d="M10 18h4" />
        </svg>
      );
    case "admin":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );
    case "financial-report":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case "cashflow":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case "financial-settings":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="1" y="4" width="22" height="16" rx="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      );
    case "fixed-costs":
      return (
        <svg
          {...s}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
          <path d="M9 7h6" />
          <path d="M9 11h6" />
          <path d="M9 15h4" />
        </svg>
      );
    default:
      return null;
  }
}
