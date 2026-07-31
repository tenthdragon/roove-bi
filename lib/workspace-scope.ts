const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Service-role code bypasses RLS, so it must never infer a tenant. Every
 * worker/webhook/scheduled operation passes its workspace explicitly.
 */
export function requireExplicitWorkspaceId(
  value: string | null | undefined,
  label: string = 'Operasi',
) {
  const workspaceId = String(value || '').trim();
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error(`${label} membutuhkan workspace_id yang valid.`);
  }
  return workspaceId;
}
