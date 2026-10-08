"use client";

import {
  useRef,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";

type Props = {
  workspaceName: string;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: Dispatch<SetStateAction<boolean>>;
  onHome: () => void;
  renderNavigation: (isMobile: boolean) => ReactNode;
  headerActions: ReactNode;
  children: ReactNode;
};

export default function DashboardFrame({
  workspaceName,
  sidebarCollapsed,
  setSidebarCollapsed,
  mobileMenuOpen,
  setMobileMenuOpen,
  onHome,
  renderNavigation,
  headerActions,
  children,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sidebarW = sidebarCollapsed ? 64 : 250;
  const workspaceBrandName = workspaceName.replace(/\s+Workspace$/i, "");
  const workspaceBrandInitial =
    workspaceBrandName.slice(0, 1).toUpperCase() || "W";
  return (
    <div
      style={{ minHeight: "100vh", background: "var(--bg)", display: "flex" }}
    >
      {/* ═══ DESKTOP SIDEBAR ═══ */}
      <aside
        className="desktop-sidebar"
        style={{
          width: sidebarW,
          height: "100dvh",
          maxHeight: "100dvh",
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 45,
          transition: "width 0.2s ease",
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: sidebarCollapsed ? "16px 0" : "16px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            gap: 10,
            cursor: "pointer",
            minHeight: 57,
          }}
        >
          <div
            onClick={onHome}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                flexShrink: 0,
                background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                fontWeight: 800,
                color: "#fff",
              }}
            >
              {workspaceBrandInitial}
            </div>
            {!sidebarCollapsed && (
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--text)",
                  whiteSpace: "nowrap",
                }}
              >
                {workspaceBrandName} BI
              </span>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              aria-label="Ciutkan sidebar"
              onClick={() => setSidebarCollapsed(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: 4,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
            </button>
          )}
          {sidebarCollapsed && (
            <button
              aria-label="Perluas sidebar"
              onClick={() => setSidebarCollapsed(false)}
              style={{
                border: "1px solid var(--border)",
                cursor: "pointer",
                color: "var(--text-muted)",
                padding: 4,
                position: "absolute",
                right: -12,
                top: 16,
                background: "var(--card)",
                borderRadius: "50%",
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
              </svg>
            </button>
          )}
        </div>

        {renderNavigation(false)}
      </aside>

      {/* ═══ MOBILE OVERLAY + SLIDE-OUT SIDEBAR ═══ */}
      {mobileMenuOpen && (
        <div
          ref={overlayRef}
          onClick={(e) => {
            if (e.target === overlayRef.current) setMobileMenuOpen(false);
          }}
          className="mobile-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "var(--overlay-bg)",
            zIndex: 100,
            backdropFilter: "blur(2px)",
          }}
        >
          <aside
            style={{
              width: 260,
              height: "100dvh",
              maxHeight: "100dvh",
              background: "var(--sidebar-bg)",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              animation: "slideIn 0.2s ease-out",
            }}
          >
            {/* Mobile sidebar header */}
            <div
              style={{
                padding: "16px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: 57,
              }}
            >
              <div
                onClick={onHome}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    fontWeight: 800,
                    color: "#fff",
                  }}
                >
                  {workspaceBrandInitial}
                </div>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  {workspaceBrandName} BI
                </span>
              </div>
                <button
                  aria-label="Tutup menu"
                  onClick={() => setMobileMenuOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--dim)",
                  padding: 4,
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {renderNavigation(true)}
          </aside>
        </div>
      )}

      {/* ═══ MAIN CONTENT ═══ */}
      <div
        className="main-content-area"
        style={{
          flex: 1,
          minWidth: 0,
          marginLeft: sidebarW,
          transition: "margin-left 0.2s ease",
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
        }}
      >
        {/* Top Bar */}
        <header
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--header-bg)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 40,
            minHeight: 49,
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Hamburger - mobile only */}
            <button
              aria-label="Buka menu"
              className="mobile-hamburger"
              onClick={() => setMobileMenuOpen(true)}
              style={{
                display: "none" /* shown via CSS on mobile */,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-secondary)",
                padding: 4,
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {headerActions}
          </div>
        </header>

        {/* Content */}
        <main
          className="dashboard-content"
          style={{
            padding: "16px 20px",
            maxWidth: 1400,
            width: "100%",
            overflowX: "hidden",
            margin: "0 auto",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
