export const ROOVE_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const APURVA_WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
export const ACTIVE_WORKSPACE_COOKIE = 'roove-active-workspace';

export type WorkspaceStatus = 'provisioning' | 'active' | 'suspended';

export type AccessibleWorkspace = {
  id: string;
  slug: string;
  name: string;
  status: WorkspaceStatus;
  membershipRole: string;
  isDefault: boolean;
};

export type WorkspaceBootstrap = {
  activeWorkspace: AccessibleWorkspace;
  workspaces: AccessibleWorkspace[];
  isPlatformOwner: boolean;
};
