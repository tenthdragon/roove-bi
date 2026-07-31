import type { SupabaseClient } from '@supabase/supabase-js';

type ResolveWorkspaceCredentialOptions = {
  supabase: SupabaseClient;
  workspaceId: string;
  provider: string;
  fallbackEnvKeys: string[];
};

type ResolveWorkspaceIntegrationValueOptions =
  ResolveWorkspaceCredentialOptions & {
    configKey: string;
    referenceConfigKey: string;
  };

function readEnvironmentReference(reference: unknown, label: string) {
  const normalized = String(reference || '').trim();
  if (!normalized) return null;
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) {
    throw new Error(`Referensi environment ${label} tidak valid.`);
  }
  return process.env[normalized] || null;
}

/**
 * Resolve an integration secret without storing the secret value in Postgres.
 *
 * workspace_integrations.credential_reference contains an environment variable
 * name (for example APURVA_WHATSAPP_ACCESS_TOKEN). There is no tenant fallback:
 * a workspace without its own integration record fails closed.
 */
export async function resolveWorkspaceCredential({
  supabase,
  workspaceId,
  provider,
  fallbackEnvKeys,
}: ResolveWorkspaceCredentialOptions): Promise<string> {
  const { data, error } = await supabase
    .from('workspace_integrations')
    .select('credential_reference')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .not('credential_reference', 'is', null)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal membaca konfigurasi integrasi ${provider}: ${error.message}`);
  }

  const reference = String(data?.credential_reference || '').trim();
  if (reference) {
    const value = readEnvironmentReference(reference, provider);
    if (!value) {
      throw new Error(`Kredensial ${provider} untuk workspace ini belum tersedia di runtime.`);
    }
    return value;
  }

  throw new Error(`Integrasi ${provider} belum dikonfigurasi untuk workspace ini.`);
}

/**
 * Resolve a non-secret integration value from workspace config. The value can
 * be stored directly in `config[configKey]`, or indirectly through an
 * environment-variable name in `config[referenceConfigKey]`.
 */
export async function resolveWorkspaceIntegrationValue({
  supabase,
  workspaceId,
  provider,
  configKey,
  referenceConfigKey,
  fallbackEnvKeys,
}: ResolveWorkspaceIntegrationValueOptions): Promise<string | null> {
  const { data, error } = await supabase
    .from('workspace_integrations')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal membaca konfigurasi integrasi ${provider}: ${error.message}`);
  }

  const config = data?.config && typeof data.config === 'object'
    ? data.config as Record<string, unknown>
    : {};
  const directValue = String(config[configKey] || '').trim();
  if (directValue) return directValue;

  const referencedValue = readEnvironmentReference(
    config[referenceConfigKey],
    `${provider}.${referenceConfigKey}`,
  );
  if (referencedValue) return referencedValue;

  return null;
}
