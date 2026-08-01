-- Workspace-owned integration credentials stored with Supabase Vault.
-- Secret values are encrypted at rest and can only be created/read through
-- service-role-only RPCs used by the application server.

BEGIN;

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION public.upsert_workspace_integration_vault_secret(
  p_workspace_id UUID,
  p_provider TEXT,
  p_secret TEXT,
  p_external_account_id TEXT DEFAULT 'default',
  p_display_name TEXT DEFAULT NULL,
  p_config JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
  v_external_account_id TEXT := BTRIM(COALESCE(p_external_account_id, 'default'));
  v_secret TEXT := BTRIM(COALESCE(p_secret, ''));
  v_secret_name TEXT;
  v_secret_id UUID;
  v_existing_reference TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Workspace integration secret writes require the service role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces workspace
    WHERE workspace.id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Workspace % was not found', p_workspace_id;
  END IF;

  IF v_provider !~ '^[a-z0-9][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION 'Integration provider is invalid';
  END IF;
  IF v_external_account_id = '' OR LENGTH(v_external_account_id) > 120 THEN
    RAISE EXCEPTION 'Integration external account id is invalid';
  END IF;
  IF LENGTH(v_secret) < 20 OR LENGTH(v_secret) > 10000 THEN
    RAISE EXCEPTION 'Integration credential length is invalid';
  END IF;

  v_secret_name := FORMAT(
    'workspace-integration:%s:%s:%s',
    p_workspace_id,
    v_provider,
    v_external_account_id
  );

  SELECT integration.credential_reference
  INTO v_existing_reference
  FROM public.workspace_integrations integration
  WHERE integration.workspace_id = p_workspace_id
    AND integration.provider = v_provider
    AND integration.external_account_id = v_external_account_id
  FOR UPDATE;

  IF COALESCE(v_existing_reference, '') ~ '^vault:[0-9a-fA-F-]{36}$' THEN
    v_secret_id := SUBSTRING(v_existing_reference FROM 7)::UUID;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets secret WHERE secret.id = v_secret_id) THEN
      v_secret_id := NULL;
    END IF;
  END IF;

  IF v_secret_id IS NULL THEN
    SELECT secret.id
    INTO v_secret_id
    FROM vault.secrets secret
    WHERE secret.name = v_secret_name
    LIMIT 1;
  END IF;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(
      v_secret,
      v_secret_name,
      FORMAT('Credential for workspace %s provider %s', p_workspace_id, v_provider)
    );
  ELSE
    PERFORM vault.update_secret(
      v_secret_id,
      v_secret,
      v_secret_name,
      FORMAT('Credential for workspace %s provider %s', p_workspace_id, v_provider)
    );
  END IF;

  INSERT INTO public.workspace_integrations (
    workspace_id,
    provider,
    external_account_id,
    display_name,
    credential_reference,
    config,
    is_active,
    updated_at
  )
  VALUES (
    p_workspace_id,
    v_provider,
    v_external_account_id,
    NULLIF(BTRIM(COALESCE(p_display_name, '')), ''),
    'vault:' || v_secret_id::TEXT,
    COALESCE(p_config, '{}'::JSONB),
    TRUE,
    NOW()
  )
  ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
  SET
    display_name = COALESCE(EXCLUDED.display_name, public.workspace_integrations.display_name),
    credential_reference = EXCLUDED.credential_reference,
    config = COALESCE(public.workspace_integrations.config, '{}'::JSONB)
      || COALESCE(EXCLUDED.config, '{}'::JSONB),
    is_active = TRUE,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_integration_vault_secret(
  p_workspace_id UUID,
  p_provider TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_reference TEXT;
  v_secret_id UUID;
  v_decrypted_secret TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Workspace integration secret reads require the service role';
  END IF;

  SELECT integration.credential_reference
  INTO v_reference
  FROM public.workspace_integrations integration
  WHERE integration.workspace_id = p_workspace_id
    AND integration.provider = LOWER(BTRIM(COALESCE(p_provider, '')))
    AND integration.is_active
  ORDER BY integration.updated_at DESC, integration.created_at DESC
  LIMIT 1;

  IF COALESCE(v_reference, '') !~ '^vault:[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;

  v_secret_id := SUBSTRING(v_reference FROM 7)::UUID;

  SELECT secret.decrypted_secret
  INTO v_decrypted_secret
  FROM vault.decrypted_secrets secret
  WHERE secret.id = v_secret_id;

  RETURN v_decrypted_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_workspace_integration_vault_secret(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_workspace_integration_vault_secret(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.get_workspace_integration_vault_secret(
  UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_integration_vault_secret(
  UUID, TEXT
) TO service_role;

-- Integration records are managed exclusively through authenticated server
-- actions using the service role. No browser client needs direct table access.
REVOKE ALL ON TABLE public.workspace_integrations FROM anon, authenticated;

COMMIT;
