'use client';

import { createContext, useContext, ReactNode } from 'react';

interface PermissionsContextValue {
  permissions: Set<string>;
  /** Returns true for owner (all access) or if the key is in the permissions set */
  can: (key: string) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: new Set(),
  can: () => false,
});

/**
 * Wrap dashboard content with this provider.
 * The parent (layout) is responsible for fetching permissions from role_permissions
 * and passing them in. Owner role always has full access.
 */
export function PermissionsProvider({
  role,
  permissions,
  children,
}: {
  role: string | null | undefined;
  permissions: Set<string>;
  children: ReactNode;
}) {
  const can = (key: string) => role === 'owner' || permissions.has(key);

  return (
    <PermissionsContext.Provider value={{ permissions, can }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export const usePermissions = () => useContext(PermissionsContext);
