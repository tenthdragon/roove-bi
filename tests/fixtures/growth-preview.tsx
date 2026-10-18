import React from "react";
import { createRoot } from "react-dom/client";
import GrowthExecution from "../../components/GrowthExecution";
import DashboardFrame from "../../components/DashboardFrame";
import DashboardNavigation from "../../components/DashboardNavigation";
import WorkspaceSwitcher from "../../components/WorkspaceSwitcher";
import { PermissionsProvider } from "../../lib/PermissionsContext";
import { WorkspaceProvider, useWorkspace } from "@/lib/WorkspaceContext";
import { FixtureNavigation, useRouter } from "./growth-navigation";
import { WORKSPACE } from "./growth-actions";
import ThemeProvider from "../../components/ThemeProvider";
import ThemeToggle from "../../components/ThemeToggle";
import { ALL_TABS } from "../../lib/utils";
import { isWorkspaceModuleEnabled } from "../../lib/workspaces";

function PreviewDashboard() {
  const { activeWorkspace } = useWorkspace();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [expandedMenus, setExpandedMenus] = React.useState<
    Record<string, boolean>
  >({});
  const enabled = isWorkspaceModuleEnabled(activeWorkspace, "growth-work");
  return (
    <DashboardFrame
      workspaceName={activeWorkspace.name}
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
      onHome={() => router.push("/dashboard/growth-work?tab=overview")}
      renderNavigation={(isMobile) => (
        <DashboardNavigation
          tabs={ALL_TABS.filter((tab) => tab.id !== "growth-work" || enabled)}
          currentTab={enabled ? "growth-work" : ""}
          isMobile={isMobile}
          sidebarCollapsed={sidebarCollapsed}
          expandedMenus={expandedMenus}
          canAccess={() => true}
          navigateTo={() => {
            router.push("/dashboard/growth-work?tab=overview");
            setMobileMenuOpen(false);
          }}
          setSidebarCollapsed={setSidebarCollapsed}
          setExpandedMenus={setExpandedMenus}
          isUnavailable={(tab) => tab.id !== "growth-work"}
        />
      )}
      headerActions={
        <>
          <WorkspaceSwitcher />
          <ThemeToggle />
          <div
            className="desktop-sidebar"
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            Growth Lead · contoh
          </div>
        </>
      }
    >
      <div
        role="status"
        style={{
          fontSize: 11,
          color: "var(--dim)",
          padding: "6px 10px",
          marginBottom: 16,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-deep)",
        }}
      >
        Preview lokal · data & perpindahan workspace simulasi · tanpa koneksi
        produksi. Kerangka dashboard memakai komponen aplikasi asli.
      </div>
      {enabled ? (
        <GrowthExecution key={activeWorkspace.id} />
      ) : (
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card)",
          }}
        >
          <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>
            Growth belum diaktifkan
          </h2>
          <p style={{ fontSize: 13, color: "var(--dim)" }}>
            Workspace contoh ini tidak memiliki pilot Growth. Beralih kembali ke
            Roove untuk melihat fitur.
          </p>
        </div>
      )}
    </DashboardFrame>
  );
}
const workspace = {
  id: WORKSPACE,
  slug: "fixture",
  name: "Roove",
  status: "active" as const,
  settings: { growth_execution_enabled: true },
  membershipRole: "owner",
  isDefault: true,
};
const sandbox = {
  ...workspace,
  id: "30000000-0000-4000-8000-000000000002",
  slug: "fixture-sandbox",
  name: "Sandbox (contoh)",
  settings: { growth_execution_enabled: false },
  isDefault: false,
};
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <FixtureNavigation>
      <PermissionsProvider role="owner" permissions={new Set()}>
        <WorkspaceProvider
          initial={{
            activeWorkspace: workspace,
            workspaces: [workspace, sandbox],
            isPlatformOwner: true,
          }}
        >
          <PreviewDashboard />
        </WorkspaceProvider>
      </PermissionsProvider>
    </FixtureNavigation>
  </ThemeProvider>,
);
