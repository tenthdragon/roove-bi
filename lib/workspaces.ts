// Keep the deployed cookie name for session continuity; its value is a generic
// workspace UUID and carries no Roove-specific authorization behavior.
export const ACTIVE_WORKSPACE_COOKIE = 'roove-active-workspace';

export type WorkspaceStatus = 'provisioning' | 'active' | 'suspended';

export type WorkspaceSettings = {
  tenant_model?: 'isolated';
  tenant_schema_version?: number;
  disabled_modules?: string[];
  warehouse_mode?: 'independent';
  warehouse_code?: string;
  inventory_entity?: string;
  warehouse_baseline_date?: string;
  warehouse_go_live_at?: string;
  warehouse_reconcile_mode?: 'legacy_attribution' | 'strict_mapping';
  cost_model?: 'legacy_monthly_overhead' | 'detailed_fixed_costs';
  legacy_order_csv_enabled?: boolean;
  legacy_cashflow_snapshot_enabled?: boolean;
  legacy_product_keywords_enabled?: boolean;
  [key: string]: unknown;
};

export type AccessibleWorkspace = {
  id: string;
  slug: string;
  name: string;
  status: WorkspaceStatus;
  settings: WorkspaceSettings;
  membershipRole: string;
  isDefault: boolean;
};

export type WorkspaceBootstrap = {
  activeWorkspace: AccessibleWorkspace;
  workspaces: AccessibleWorkspace[];
  isPlatformOwner: boolean;
};

export function isWorkspaceModuleEnabled(
  workspace: Pick<AccessibleWorkspace, 'settings'>,
  moduleId: string,
) {
  const disabledModules = Array.isArray(workspace.settings?.disabled_modules)
    ? workspace.settings.disabled_modules
    : [];
  return !disabledModules.includes(moduleId);
}
