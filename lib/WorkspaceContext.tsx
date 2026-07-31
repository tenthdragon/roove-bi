'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  AccessibleWorkspace,
  WorkspaceBootstrap,
} from './workspaces';

type WorkspaceContextValue = WorkspaceBootstrap & {
  switching: boolean;
  switchWorkspace: (workspaceId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

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
  const [switching, setSwitching] = useState(false);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!workspaceId || workspaceId === activeWorkspace.id || switching) return;
      setSwitching(true);
      try {
        const response = await fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.error) {
          throw new Error(result.error || 'Gagal mengganti workspace.');
        }
        setActiveWorkspace(result.activeWorkspace as AccessibleWorkspace);
        window.location.assign('/dashboard');
      } finally {
        setSwitching(false);
      }
    },
    [activeWorkspace.id, switching],
  );

  const value = useMemo(
    () => ({
      activeWorkspace,
      workspaces: initial.workspaces,
      isPlatformOwner: initial.isPlatformOwner,
      switching,
      switchWorkspace,
    }),
    [
      activeWorkspace,
      initial.isPlatformOwner,
      initial.workspaces,
      switchWorkspace,
      switching,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider.');
  }
  return context;
}
