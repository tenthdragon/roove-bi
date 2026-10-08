// Local preview-only adapter. Never imported by a production route.
import { createContext, useContext, useState, type ReactNode } from "react";
import type {
  WorkspaceBootstrap,
  WorkspaceSettings,
} from "../../lib/workspaces";

type Value = WorkspaceBootstrap & {
  switching: boolean;
  switchWorkspace: (id: string) => Promise<void>;
  updateActiveWorkspaceSettings: (settings: Partial<WorkspaceSettings>) => void;
};
const Context = createContext<Value | null>(null);
export function WorkspaceProvider({
  initial,
  children,
}: {
  initial: WorkspaceBootstrap;
  children: ReactNode;
}) {
  const [activeWorkspace, setActiveWorkspace] = useState(
    initial.activeWorkspace,
  );
  return (
    <Context.Provider
      value={{
        ...initial,
        activeWorkspace,
        switching: false,
        switchWorkspace: async (id) => {
          const workspace = initial.workspaces.find(
            (item) => item.id === id && item.status === "active",
          );
          if (workspace) setActiveWorkspace(workspace);
        },
        updateActiveWorkspaceSettings: (settings) =>
          setActiveWorkspace((current) => ({
            ...current,
            settings: { ...current.settings, ...settings },
          })),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Fixture workspace provider is missing.");
  return value;
}
