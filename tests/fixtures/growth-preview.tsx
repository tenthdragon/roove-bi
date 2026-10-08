import React from "react";
import { createRoot } from "react-dom/client";
import GrowthExecution from "../../components/GrowthExecution";
import { PermissionsProvider } from "../../lib/PermissionsContext";
import { WorkspaceProvider } from "../../lib/WorkspaceContext";
import { FixtureNavigation } from "./growth-navigation";
import { WORKSPACE } from "./growth-actions";
import ThemeProvider from "../../components/ThemeProvider";
import ThemeToggle from "../../components/ThemeToggle";
import { ALL_TABS } from "../../lib/utils";
import {
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Share2,
  FileText,
  Warehouse,
  TrendingUp,
  Users,
  Layers,
  DollarSign,
  Building2,
  Wrench,
  Settings,
  Menu,
  X,
} from "lucide-react";

const icons = {
  ClipboardList,
  LayoutDashboard,
  Megaphone,
  Share2,
  FileText,
  Warehouse,
  TrendingUp,
  Users,
  Layers,
  DollarSign,
  Building2,
  Wrench,
  Settings,
};

// Authentication and navigation to other modules are intentionally absent in
// this fixture. Theme components, navigation definitions and CSS are production imports.
function PreviewDashboard({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const groups = [...new Set(ALL_TABS.map((tab) => tab.group))];
  const navigation = (
    <>
      <div
        style={{
          padding: 16,
          display: "flex",
          gap: 10,
          alignItems: "center",
          minHeight: 57,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
            display: "grid",
            placeItems: "center",
            fontSize: 15,
            fontWeight: 800,
            color: "white",
          }}
        >
          R
        </div>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Roove BI</span>
        {mobileOpen && (
          <button
            aria-label="Tutup menu"
            onClick={() => setMobileOpen(false)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: 0,
              color: "var(--dim)",
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <nav
        aria-label="Navigasi dashboard preview"
        style={{ padding: "8px 12px", overflowY: "auto", flex: 1 }}
      >
        {groups.map((group) => (
          <section key={group}>
            <div
              style={{
                padding: "16px 12px 8px",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {group}
            </div>
            {ALL_TABS.filter((tab) => tab.group === group).map((tab) => {
              const active = tab.id === "growth-work";
              const Icon =
                icons[tab.icon as keyof typeof icons] || ClipboardList;
              return (
                <button
                  key={tab.id}
                  aria-current={active ? "page" : undefined}
                  disabled={!active}
                  title={
                    active
                      ? tab.label
                      : "Modul ini tidak dimuat dalam preview Growth"
                  }
                  onClick={() => setMobileOpen(false)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "10px 12px",
                    marginBottom: 2,
                    borderRadius: 8,
                    border: "none",
                    background: active
                      ? "var(--sidebar-active)"
                      : "transparent",
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                    fontSize: 14,
                    fontWeight: active ? 600 : 500,
                    textAlign: "left",
                    cursor: active ? "pointer" : "default",
                  }}
                >
                  <Icon size={20} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </section>
        ))}
      </nav>
      <div
        style={{
          padding: 16,
          borderTop: "1px solid var(--border)",
          color: "var(--dim)",
          fontSize: 11,
        }}
      >
        Growth Lead · data contoh
      </div>
    </>
  );
  const sidebarStyle: React.CSSProperties = {
    width: 240,
    position: "fixed",
    inset: "0 auto 0 0",
    background: "var(--sidebar-bg)",
    borderRight: "1px solid var(--border)",
    flexDirection: "column",
    zIndex: 50,
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <aside
        className="desktop-sidebar"
        style={{ ...sidebarStyle, display: "flex" }}
      >
        {navigation}
      </aside>
      {mobileOpen && (
        <div
          className="mobile-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--overlay-bg)",
            zIndex: 60,
          }}
          onClick={() => setMobileOpen(false)}
        >
          <aside
            style={{ ...sidebarStyle, display: "flex", width: 260, zIndex: 61 }}
            onClick={(event) => event.stopPropagation()}
          >
            {navigation}
          </aside>
        </div>
      )}
      <div
        className="main-content-area"
        style={{ marginLeft: 240, width: "calc(100% - 240px)", minWidth: 0 }}
      >
        <header
          style={{
            padding: "10px 16px",
            minHeight: 49,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            background: "var(--header-bg)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          <button
            className="mobile-hamburger"
            aria-label="Buka menu"
            onClick={() => setMobileOpen(true)}
            style={{
              display: "none",
              background: "none",
              border: 0,
              color: "var(--text-secondary)",
            }}
          >
            <Menu size={22} />
          </button>
          <span style={{ color: "var(--dim)", fontSize: 11 }}>
            Preview lokal · data contoh · tanpa koneksi produksi
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Roove
            </span>
            <ThemeToggle />
          </div>
        </header>
        <main
          className="dashboard-content"
          style={{
            padding: "16px 20px",
            maxWidth: 1400,
            width: "100%",
            margin: "0 auto",
            overflowX: "hidden",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
const workspace = {
  id: WORKSPACE,
  slug: "fixture",
  name: "Preview Fixture",
  status: "active" as const,
  settings: { growth_execution_enabled: true },
  membershipRole: "owner",
  isDefault: true,
};
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <FixtureNavigation>
      <PermissionsProvider role="owner" permissions={new Set()}>
        <WorkspaceProvider
          initial={{
            activeWorkspace: workspace,
            workspaces: [workspace],
            isPlatformOwner: true,
          }}
        >
          <PreviewDashboard>
            <GrowthExecution />
          </PreviewDashboard>
        </WorkspaceProvider>
      </PermissionsProvider>
    </FixtureNavigation>
  </ThemeProvider>,
);
