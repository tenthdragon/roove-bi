import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import DashboardFrame from "../components/DashboardFrame";
import DashboardNavigation from "../components/DashboardNavigation";
import DashboardMetricCard from "../components/DashboardMetricCard";
import WorkspaceSwitcher from "../components/WorkspaceSwitcher";
import { WorkspaceProvider } from "../lib/WorkspaceContext";
import type { TabDef } from "../lib/utils";

// tsx's non-Next runner uses classic JSX for the existing context modules.
Object.assign(globalThis, { React });
const workspace = {
  id: "workspace-a",
  slug: "a",
  name: "Roove Workspace",
  status: "active" as const,
  settings: {},
  membershipRole: "owner",
  isDefault: true,
};
const noop = () => {};

test("shared dashboard frame retains workspace selector, content and responsive shell", () => {
  const html = renderToStaticMarkup(
    <WorkspaceProvider
      initial={{
        activeWorkspace: workspace,
        workspaces: [
          workspace,
          { ...workspace, id: "workspace-b", name: "Other" },
        ],
        isPlatformOwner: true,
      }}
    >
      <DashboardFrame
        workspaceName={workspace.name}
        sidebarCollapsed={false}
        setSidebarCollapsed={noop}
        mobileMenuOpen={false}
        setMobileMenuOpen={noop}
        onHome={noop}
        renderNavigation={() => <nav>Navigation</nav>}
        headerActions={<WorkspaceSwitcher />}
      >
        <h1>Growth</h1>
      </DashboardFrame>
    </WorkspaceProvider>,
  );
  assert.match(html, /aria-label="Pilih workspace"/);
  assert.match(html, /value="workspace-a" selected/);
  assert.match(html, /value="workspace-b"/);
  assert.match(html, /width:250px/);
  assert.match(html, /main-content-area/);
  assert.match(html, /dashboard-content/);
  assert.match(html, /Roove BI/);
  assert.match(html, /<h1>Growth<\/h1>/);
  assert.match(html, /aria-label="Ciutkan sidebar"/);
});

test("shared navigation preserves child-only permission semantics on mobile", () => {
  const tabs: TabDef[] = [
    {
      id: "channels",
      label: "Sales",
      icon: "Share2",
      group: "Main Menu",
      children: [
        { id: "waba-management", label: "WABA", icon: "MessageCircle" },
      ],
    },
  ];
  const html = renderToStaticMarkup(
    <DashboardNavigation
      tabs={tabs}
      currentTab="waba-management"
      isMobile
      sidebarCollapsed={false}
      expandedMenus={{}}
      canAccess={(tab) => tab.id === "waba-management"}
      navigateTo={noop}
      setSidebarCollapsed={noop}
      setExpandedMenus={noop}
      onLogout={noop}
    />,
  );
  assert.match(html, /WABA/);
  assert.doesNotMatch(html, />Sales</);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Logout/);
});

test("preview-only unavailable navigation never changes production defaults", () => {
  const props = {
    tabs: [{ id: "growth-work", label: "Growth", icon: "ClipboardList" }],
    currentTab: "growth-work",
    sidebarCollapsed: false,
    expandedMenus: {},
    canAccess: () => true,
    navigateTo: noop,
    setSidebarCollapsed: noop,
    setExpandedMenus: noop,
    onLogout: noop,
  };
  const production = renderToStaticMarkup(<DashboardNavigation {...props} />);
  const fixture = renderToStaticMarkup(
    <DashboardNavigation {...props} isUnavailable={() => true} />,
  );
  assert.doesNotMatch(production, /disabled/);
  assert.match(fixture, /disabled/);
  assert.match(production, /aria-current="page"/);
  assert.match(production, /<svg/);
});

test("Marketing and Growth use one KPI card and production routes never load fixture adapters", () => {
  const html = renderToStaticMarkup(
    <DashboardMetricCard
      label="CM3"
      value="N/A"
      color="var(--red)"
      sub="Missing source"
    >
      <span>Context</span>
    </DashboardMetricCard>,
  );
  assert.match(html, /background:var\(--card\)/);
  assert.match(html, /background:var\(--red\)/);
  assert.match(html, /font-family:monospace/);
  assert.match(html, /N\/A/);
  assert.match(html, /Context/);
  for (const path of [
    "app/dashboard/layout.tsx",
    "app/dashboard/marketing/page.tsx",
    "components/GrowthExecution.tsx",
  ]) {
    const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fixtures/);
    assert.match(
      source,
      path.includes("layout") ? /DashboardFrame/ : /DashboardMetricCard/,
    );
  }
});
