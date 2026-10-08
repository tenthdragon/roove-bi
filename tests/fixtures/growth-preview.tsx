import React from "react";
import { createRoot } from "react-dom/client";
import GrowthExecution from "../../components/GrowthExecution";
import { PermissionsProvider } from "../../lib/PermissionsContext";
import { WorkspaceProvider } from "../../lib/WorkspaceContext";
import { FixtureNavigation } from "./growth-navigation";
import { WORKSPACE } from "./growth-actions";
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
  <FixtureNavigation>
    <PermissionsProvider role="owner" permissions={new Set()}>
      <WorkspaceProvider
        initial={{
          activeWorkspace: workspace,
          workspaces: [workspace],
          isPlatformOwner: true,
        }}
      >
        <div
          style={{
            background: "#0f766e",
            color: "white",
            padding: "8px 24px",
            fontSize: 12,
          }}
        >
          Preview lokal · data contoh · tidak terhubung ke produksi
        </div>
        <GrowthExecution />
      </WorkspaceProvider>
    </PermissionsProvider>
  </FixtureNavigation>,
);
