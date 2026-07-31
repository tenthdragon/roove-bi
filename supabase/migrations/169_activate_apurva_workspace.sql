-- ============================================================================
-- 169: Activate Apurva after tenant isolation and safe rollout boundaries
-- ============================================================================

BEGIN;

UPDATE public.workspaces
SET
  status = 'active',
  settings = COALESCE(settings, '{}'::JSONB) || jsonb_build_object(
    'shared_warehouse_code', 'BTN',
    'inventory_entity', 'APV',
    'rollout_blocked_tabs', jsonb_build_array(
      'ppic',
      'warehouse-settings',
      'marketplace-intake',
      'customers',
      'brand-analysis',
      'sales-channel-analysis'
    )
  ),
  updated_at = NOW()
WHERE id = '00000000-0000-4000-8000-000000000002'::UUID;

INSERT INTO public.workspace_integrations (
  workspace_id,
  provider,
  external_account_id,
  display_name,
  credential_reference,
  config,
  is_active
)
VALUES
  (
    '00000000-0000-4000-8000-000000000002'::UUID,
    'meta',
    'default',
    'Apurva Meta',
    'APURVA_META_ACCESS_TOKEN',
    '{"business_id_reference":"APURVA_META_BUSINESS_ID"}'::JSONB,
    TRUE
  ),
  (
    '00000000-0000-4000-8000-000000000002'::UUID,
    'whatsapp',
    'default',
    'Apurva WhatsApp',
    'APURVA_WHATSAPP_ACCESS_TOKEN',
    '{}'::JSONB,
    TRUE
  )
ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  credential_reference = EXCLUDED.credential_reference,
  config = EXCLUDED.config,
  is_active = TRUE,
  updated_at = NOW();

COMMIT;
