"use client";

import { useWorkspace } from "@/lib/WorkspaceContext";

export default function WorkspaceSwitcher() {
  const { activeWorkspace, workspaces, switching, switchWorkspace } =
    useWorkspace();

  if (workspaces.length <= 1) {
    return (
      <div
        className="desktop-sidebar"
        style={{
          fontSize: 11,
          color: "var(--text-secondary)",
          fontWeight: 650,
          padding: "5px 9px",
          border: "1px solid var(--border)",
          borderRadius: 7,
          background: "var(--bg-deep)",
        }}
      >
        {activeWorkspace.name}
      </div>
    );
  }

  return (
    <select
      aria-label="Pilih workspace"
      value={activeWorkspace.id}
      disabled={switching}
      onChange={(event) => switchWorkspace(event.target.value)}
      style={{
        maxWidth: 190,
        padding: "5px 28px 5px 9px",
        borderRadius: 7,
        border: "1px solid var(--border)",
        background: "var(--bg-deep)",
        color: "var(--text-secondary)",
        fontSize: 11,
        fontWeight: 650,
        cursor: switching ? "wait" : "pointer",
      }}
    >
      {workspaces.map((workspace) => (
        <option
          key={workspace.id}
          value={workspace.id}
          disabled={workspace.status !== "active"}
        >
          {workspace.name}
          {workspace.status === "provisioning" ? " (Provisioning)" : ""}
        </option>
      ))}
    </select>
  );
}
