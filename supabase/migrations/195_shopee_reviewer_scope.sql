BEGIN;

-- Existing roles that could already see Marketing/Shopee keep that access
-- after the Shopee page and admin panel receive dedicated permission keys.
INSERT INTO public.role_permissions (role, permission_key)
SELECT DISTINCT role, 'tab:shopee-details'
FROM public.role_permissions
WHERE permission_key = 'tab:marketing'
  AND role NOT IN ('marketing_api_reviewer', 'shopee_reviewer')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
SELECT DISTINCT role, 'admin:shopee'
FROM public.role_permissions
WHERE permission_key = 'admin:meta'
  AND role NOT IN ('marketing_api_reviewer', 'shopee_reviewer')
ON CONFLICT DO NOTHING;

INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
SELECT DISTINCT workspace_id, role, 'tab:shopee-details'
FROM public.workspace_role_permissions
WHERE permission_key = 'tab:marketing'
  AND role NOT IN ('marketing_api_reviewer', 'shopee_reviewer')
ON CONFLICT DO NOTHING;

INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
SELECT DISTINCT workspace_id, role, 'admin:shopee'
FROM public.workspace_role_permissions
WHERE permission_key = 'admin:meta'
  AND role NOT IN ('marketing_api_reviewer', 'shopee_reviewer')
ON CONFLICT DO NOTHING;

-- Replace the legacy broad Marketing API reviewer with a narrowly scoped role.
UPDATE public.profiles
SET role = 'shopee_reviewer'::public.user_role
WHERE role::text = 'marketing_api_reviewer';

UPDATE public.workspace_memberships
SET role = 'shopee_reviewer',
    updated_at = NOW()
WHERE role = 'marketing_api_reviewer';

-- Historical pending accounts were represented as active memberships. Keep
-- them visible to Admin Users, but normalize them to a non-access state.
UPDATE public.workspace_memberships
SET status = 'suspended',
    is_default = FALSE,
    updated_at = NOW()
WHERE role = 'pending'
  AND status = 'active';

DO $$
DECLARE
  v_user record;
  v_previous_workspace_id uuid;
  v_next_workspace_id uuid;
  v_next_membership_role text;
  v_compatibility_role text;
BEGIN
  FOR v_user IN
    SELECT profile.id AS user_id
    FROM public.profiles AS profile
    WHERE profile.role::text <> 'owner'
      AND (
        profile.role::text = 'pending'
        OR NOT EXISTS (
          SELECT 1
          FROM public.workspace_memberships AS membership
          JOIN public.workspaces AS workspace
            ON workspace.id = membership.workspace_id
          WHERE membership.user_id = profile.id
            AND membership.workspace_id = profile.active_workspace_id
            AND membership.status = 'active'
            AND membership.role <> 'pending'
            AND workspace.status = 'active'
        )
      )
  LOOP
    SELECT active_workspace_id
    INTO v_previous_workspace_id
    FROM public.profiles
    WHERE id = v_user.user_id
    FOR UPDATE;

    v_next_workspace_id := NULL;
    v_next_membership_role := NULL;

    SELECT membership.workspace_id, membership.role
    INTO v_next_workspace_id, v_next_membership_role
    FROM public.workspace_memberships AS membership
    JOIN public.workspaces AS workspace ON workspace.id = membership.workspace_id
    WHERE membership.user_id = v_user.user_id
      AND membership.status = 'active'
      AND membership.role <> 'pending'
      AND workspace.status = 'active'
    ORDER BY
      (membership.workspace_id = v_previous_workspace_id) DESC,
      membership.is_default DESC,
      membership.created_at ASC
    LIMIT 1;

    IF v_next_workspace_id IS NULL THEN
      UPDATE public.workspace_memberships
      SET is_default = FALSE
      WHERE user_id = v_user.user_id
        AND is_default;

      UPDATE public.profiles
      SET role = 'pending'::public.user_role,
          active_workspace_id = NULL
      WHERE id = v_user.user_id;
    ELSE
      UPDATE public.workspace_memberships
      SET is_default = FALSE
      WHERE user_id = v_user.user_id
        AND is_default;

      UPDATE public.workspace_memberships
      SET is_default = TRUE
      WHERE user_id = v_user.user_id
        AND workspace_id = v_next_workspace_id
        AND status = 'active';

      v_compatibility_role := CASE
        WHEN v_next_membership_role = 'workspace_owner' THEN 'admin'
        ELSE v_next_membership_role
      END;
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type type
        JOIN pg_enum enum ON enum.enumtypid = type.oid
        JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = 'public'
          AND type.typname = 'user_role'
          AND enum.enumlabel = v_compatibility_role
      ) THEN
        v_compatibility_role := 'manager';
      END IF;

      UPDATE public.profiles
      SET role = v_compatibility_role::public.user_role,
          active_workspace_id = v_next_workspace_id
      WHERE id = v_user.user_id;
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.workspace_memberships
  DROP CONSTRAINT IF EXISTS workspace_memberships_no_active_pending_role;
ALTER TABLE public.workspace_memberships
  ADD CONSTRAINT workspace_memberships_no_active_pending_role
  CHECK (status <> 'active' OR role <> 'pending');

DELETE FROM public.role_permissions
WHERE role IN ('marketing_api_reviewer', 'shopee_reviewer');

INSERT INTO public.role_permissions (role, permission_key)
VALUES
  ('shopee_reviewer', 'tab:shopee-details'),
  ('shopee_reviewer', 'admin:shopee')
ON CONFLICT DO NOTHING;

DELETE FROM public.workspace_role_permissions
WHERE role IN ('marketing_api_reviewer', 'shopee_reviewer');

INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
SELECT workspace.id, 'shopee_reviewer', permission.permission_key
FROM public.workspaces workspace
CROSS JOIN (
  VALUES
    ('tab:shopee-details'::text),
    ('admin:shopee'::text)
) AS permission(permission_key)
ON CONFLICT DO NOTHING;

ALTER TABLE public.role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_shopee_reviewer_scope;
ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_shopee_reviewer_scope
  CHECK (
    role NOT IN ('shopee_reviewer', 'marketing_api_reviewer')
    OR (
      role = 'shopee_reviewer'
      AND permission_key IN ('tab:shopee-details', 'admin:shopee')
    )
  );

ALTER TABLE public.workspace_role_permissions
  DROP CONSTRAINT IF EXISTS workspace_role_permissions_shopee_reviewer_scope;
ALTER TABLE public.workspace_role_permissions
  ADD CONSTRAINT workspace_role_permissions_shopee_reviewer_scope
  CHECK (
    role NOT IN ('shopee_reviewer', 'marketing_api_reviewer')
    OR (
      role = 'shopee_reviewer'
      AND permission_key IN ('tab:shopee-details', 'admin:shopee')
    )
  );

-- Cap the role inside both permission helpers. Even an accidental extra row in
-- the matrix cannot grant a Shopee reviewer access outside these two keys.
CREATE OR REPLACE FUNCTION public.dashboard_has_permission(
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner()
    OR EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.workspace_memberships membership
        ON membership.workspace_id = profile.active_workspace_id
       AND membership.user_id = profile.id
       AND membership.status = 'active'
      LEFT JOIN public.workspace_role_permissions permission
        ON permission.workspace_id = membership.workspace_id
       AND permission.role = membership.role
       AND permission.permission_key = p_permission_key
      WHERE profile.id = auth.uid()
        AND (
          membership.role = 'workspace_owner'
          OR (
            permission.permission_key IS NOT NULL
            AND (
              membership.role <> 'marketing_api_reviewer'
              AND membership.role <> 'pending'
              AND (
                membership.role <> 'shopee_reviewer'
                OR p_permission_key IN ('tab:shopee-details', 'admin:shopee')
              )
            )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.dashboard_has_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_has_permission(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_has_workspace_permission(
  p_workspace_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner()
    OR EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.workspace_memberships membership
        ON membership.workspace_id = p_workspace_id
       AND membership.user_id = profile.id
       AND membership.status = 'active'
      LEFT JOIN public.workspace_role_permissions permission
        ON permission.workspace_id = membership.workspace_id
       AND permission.role = membership.role
       AND permission.permission_key = p_permission_key
      WHERE profile.id = auth.uid()
        AND profile.active_workspace_id = p_workspace_id
        AND (
          membership.role = 'workspace_owner'
          OR (
            permission.permission_key IS NOT NULL
            AND (
              membership.role <> 'marketing_api_reviewer'
              AND membership.role <> 'pending'
              AND (
                membership.role <> 'shopee_reviewer'
                OR p_permission_key IN ('tab:shopee-details', 'admin:shopee')
              )
            )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.dashboard_has_workspace_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_has_workspace_permission(uuid, text) TO authenticated;

-- The reviewer consumes all business data through scoped server actions.
-- Block its browser JWT from directly reading or mutating workspace tables,
-- including tables whose historical policies are broadly permissive.
CREATE OR REPLACE FUNCTION public.dashboard_is_restricted_shopee_reviewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public.is_platform_owner()
    AND (
      EXISTS (
        SELECT 1
        FROM public.profiles profile
        WHERE profile.id = auth.uid()
          AND profile.role::text = 'pending'
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles profile
        JOIN public.workspace_memberships membership
          ON membership.workspace_id = profile.active_workspace_id
         AND membership.user_id = profile.id
         AND membership.status = 'active'
        WHERE profile.id = auth.uid()
          AND membership.role IN (
            'shopee_reviewer',
            'marketing_api_reviewer',
            'pending'
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.dashboard_is_restricted_shopee_reviewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_is_restricted_shopee_reviewer() TO authenticated;

-- Existing workspace read models are SECURITY DEFINER functions. Make their
-- shared membership guard return false for the restricted reviewer, while
-- preserving platform-owner and service-role behavior. This prevents a
-- reviewer from calling unrelated dashboard RPCs directly through PostgREST.
CREATE OR REPLACE FUNCTION public.workspace_can_access(
  p_workspace_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner(p_user_id)
    OR (
      auth.role() = 'service_role'
      AND public.workspace_has_membership(p_workspace_id, p_user_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.workspace_memberships membership
      WHERE membership.workspace_id = p_workspace_id
        AND membership.user_id = p_user_id
        AND membership.status = 'active'
        AND membership.role NOT IN (
          'shopee_reviewer',
          'marketing_api_reviewer',
          'pending'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.profiles profile
          WHERE profile.id = p_user_id
            AND profile.role::text = 'pending'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.workspace_can_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_can_access(uuid, uuid) TO authenticated;

-- The profile self-policy remains available for login bootstrap, but a Shopee
-- reviewer must not inherit the team-wide profile read policy.
DROP POLICY IF EXISTS shopee_reviewer_profile_boundary ON public.profiles;
CREATE POLICY shopee_reviewer_profile_boundary
  ON public.profiles
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    NOT public.dashboard_is_restricted_shopee_reviewer()
    OR id = auth.uid()
  )
  WITH CHECK (
    NOT public.dashboard_is_restricted_shopee_reviewer()
    OR (
      id = auth.uid()
      AND active_workspace_id IS NOT NULL
    )
  );

-- Inventory uses owner_workspace_id rather than workspace_id and therefore is
-- outside the generic table loop below.
DROP POLICY IF EXISTS shopee_reviewer_inventory_boundary
  ON public.warehouse_products;
CREATE POLICY shopee_reviewer_inventory_boundary
  ON public.warehouse_products
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (NOT public.dashboard_is_restricted_shopee_reviewer())
  WITH CHECK (NOT public.dashboard_is_restricted_shopee_reviewer());

-- Legacy global read/refresh overloads predate workspace scoping. Runtime
-- callers already use the service client, so browser roles must not retain the
-- default PUBLIC EXECUTE privilege on these SECURITY DEFINER functions.
DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_live_cashflow(integer,integer)',
    'public.get_live_cashflow_by_channel(integer,integer)',
    'public.get_shipment_status(date,date)',
    'public.get_daily_shipment_counts(date,date)',
    'public.get_daily_shipping_charge_data(date,date)',
    'public.get_customer_type_daily_exact(date,date,text,text)',
    'public.get_customer_type_period_exact(date,date,text)',
    'public.get_available_brands()',
    'public.get_channel_ltv_90d(text)',
    'public.get_ltv_trend_by_cohort(text)',
    'public.get_channel_cac()',
    'public.get_monthly_cac(text)',
    'public.get_owned_brand_buyer_health(integer)',
    'public.recalculate_summaries_range(date,date)',
    'public.recalculate_all_summaries()',
    'public.fn_recalculate_date_range(date,date)',
    'public.fn_recalculate_all_summaries()',
    'public.refresh_brand_analysis()',
    'public.refresh_order_views(boolean)',
    'public.refresh_single_mv(text)',
    'public.recalculate_workspace_summaries(uuid,date,date)',
    'public.refresh_customer_first_order_exact(text)',
    'public.resolve_workspace_brand_id(uuid,text)',
    'public.sync_canonical_brand_identity()',
    'public.sync_customer_first_order_exact()',
    'public.warehouse_adjust_stock_workspace(uuid,integer,numeric,text,text,uuid)',
    'public.warehouse_deduct_fifo_workspace(uuid,integer,numeric,text,text,text,timestamp with time zone,integer)',
    'public.audit_workspace_financial_target()',
    'public.enforce_shopee_ads_shop_reference()'
  ]
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      v_signature
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT DISTINCT class.relname
    FROM pg_class class
    JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = class.oid
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p')
      AND class.relrowsecurity
      AND attribute.attname = 'workspace_id'
      AND NOT attribute.attisdropped
      AND class.relname NOT IN (
        'workspace_memberships',
        'workspace_role_permissions'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS shopee_reviewer_direct_access_boundary ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY shopee_reviewer_direct_access_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.dashboard_is_restricted_shopee_reviewer()) WITH CHECK (NOT public.dashboard_is_restricted_shopee_reviewer())',
      v_table
    );
  END LOOP;
END
$$;

-- Replace a workspace permission matrix atomically. The Shopee reviewer rows
-- are always reconstructed from the fixed contract instead of trusting input.
CREATE OR REPLACE FUNCTION public.replace_workspace_role_permissions(
  p_workspace_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Serialize matrix replacements for the same workspace so concurrent saves
  -- cannot interleave their DELETE/INSERT phases.
  PERFORM 1
  FROM public.workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace does not exist';
  END IF;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Permission rows must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb))
      AS submitted(role text, permission_key text)
    WHERE NULLIF(BTRIM(role), '') IS NULL
       OR NULLIF(BTRIM(permission_key), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Permission role and key are required';
  END IF;

  DELETE FROM public.workspace_role_permissions
  WHERE workspace_id = p_workspace_id;

  INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
  SELECT DISTINCT
    p_workspace_id,
    BTRIM(submitted.role),
    BTRIM(submitted.permission_key)
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb))
    AS submitted(role text, permission_key text)
  WHERE BTRIM(submitted.role) NOT IN (
    'shopee_reviewer',
    'marketing_api_reviewer'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.workspace_role_permissions (workspace_id, role, permission_key)
  VALUES
    (p_workspace_id, 'shopee_reviewer', 'tab:shopee-details'),
    (p_workspace_id, 'shopee_reviewer', 'admin:shopee')
  ON CONFLICT DO NOTHING;

  SELECT COUNT(*)::integer
  INTO v_count
  FROM public.workspace_role_permissions
  WHERE workspace_id = p_workspace_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_workspace_role_permissions(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_workspace_role_permissions(uuid, jsonb)
  TO service_role;

-- Keep membership state, the legacy profile compatibility role, and the
-- selected workspace in one transaction. Passing `pending` means revoke this
-- workspace membership; it never leaves an active membership with a pending
-- role behind.
CREATE OR REPLACE FUNCTION public.set_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text,
  p_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := LOWER(BTRIM(COALESCE(p_role, '')));
  v_profile_role text;
  v_active_workspace_id uuid;
  v_has_valid_active_workspace boolean;
  v_was_default boolean;
  v_current_membership_role text;
  v_current_membership_status text;
  v_next_workspace_id uuid;
  v_next_membership_role text;
  v_compatibility_role text;
  v_should_make_default boolean;
BEGIN
  IF v_role NOT IN (
    'workspace_owner',
    'admin',
    'shopee_reviewer',
    'direktur_ops',
    'staf_ops',
    'direktur_finance',
    'staf_finance',
    'brand_manager',
    'sales_manager',
    'warehouse_manager',
    'ppic_manager',
    'pending'
  ) THEN
    RAISE EXCEPTION 'Invalid workspace role';
  END IF;

  PERFORM 1
  FROM public.workspaces
  WHERE id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace does not exist';
  END IF;

  IF NOT public.is_platform_owner(p_actor_user_id)
     AND NOT EXISTS (
       SELECT 1
       FROM public.workspace_memberships
       WHERE workspace_id = p_workspace_id
         AND user_id = p_actor_user_id
         AND role = 'workspace_owner'
         AND status = 'active'
     ) THEN
    RAISE EXCEPTION 'Actor cannot manage workspace roles';
  END IF;

  IF p_actor_user_id = p_user_id
     AND NOT public.is_platform_owner(p_actor_user_id) THEN
    RAISE EXCEPTION 'A workspace owner cannot change their own role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Target profile does not exist';
  END IF;

  IF v_role = 'pending'
     AND NOT EXISTS (
       SELECT 1
       FROM public.workspace_memberships
       WHERE workspace_id = p_workspace_id
         AND user_id = p_user_id
     ) THEN
    RAISE EXCEPTION 'Workspace membership does not exist';
  END IF;

  INSERT INTO public.workspace_memberships (
    workspace_id,
    user_id,
    role,
    status,
    is_default
  )
  VALUES (
    p_workspace_id,
    p_user_id,
    v_role,
    'suspended',
    FALSE
  )
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  SELECT
    profile.role::text,
    profile.active_workspace_id,
    membership.is_default,
    membership.role,
    membership.status
  INTO
    v_profile_role,
    v_active_workspace_id,
    v_was_default,
    v_current_membership_role,
    v_current_membership_status
  FROM public.workspace_memberships AS membership
  JOIN public.profiles AS profile
    ON profile.id = membership.user_id
  WHERE membership.workspace_id = p_workspace_id
    AND membership.user_id = p_user_id
  FOR UPDATE OF membership, profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace membership does not exist';
  END IF;

  IF v_profile_role = 'owner' THEN
    RAISE EXCEPTION 'Platform owner role cannot be changed here';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships AS membership
    JOIN public.workspaces AS workspace ON workspace.id = membership.workspace_id
    WHERE membership.user_id = p_user_id
      AND membership.workspace_id = v_active_workspace_id
      AND membership.status = 'active'
      AND membership.role <> 'pending'
      AND workspace.status = 'active'
  )
  INTO v_has_valid_active_workspace;

  IF v_current_membership_status = 'active'
     AND v_current_membership_role = 'workspace_owner'
     AND v_role <> 'workspace_owner'
     AND (
       SELECT COUNT(*)
       FROM public.workspace_memberships
       WHERE workspace_id = p_workspace_id
         AND role = 'workspace_owner'
         AND status = 'active'
     ) <= 1 THEN
    RAISE EXCEPTION 'The last workspace owner cannot be removed';
  END IF;

  IF v_role = 'pending' THEN
    UPDATE public.workspace_memberships
    SET status = 'suspended',
        is_default = FALSE,
        updated_at = NOW()
    WHERE workspace_id = p_workspace_id
      AND user_id = p_user_id;

    IF v_active_workspace_id = p_workspace_id
       OR NOT v_has_valid_active_workspace
       OR v_was_default THEN
      SELECT membership.workspace_id, membership.role
      INTO v_next_workspace_id, v_next_membership_role
      FROM public.workspace_memberships AS membership
      JOIN public.workspaces AS workspace
        ON workspace.id = membership.workspace_id
      WHERE membership.user_id = p_user_id
        AND membership.status = 'active'
        AND membership.role <> 'pending'
        AND workspace.status = 'active'
      ORDER BY
        (membership.workspace_id = v_active_workspace_id) DESC,
        membership.is_default DESC,
        membership.created_at ASC
      LIMIT 1
      FOR UPDATE OF membership;

      IF v_next_workspace_id IS NULL THEN
        UPDATE public.profiles
        SET role = 'pending'::public.user_role,
            active_workspace_id = NULL
        WHERE id = p_user_id;
      ELSE
        UPDATE public.workspace_memberships
        SET is_default = FALSE
        WHERE user_id = p_user_id
          AND is_default;

        UPDATE public.workspace_memberships
        SET is_default = TRUE,
            updated_at = NOW()
        WHERE user_id = p_user_id
          AND workspace_id = v_next_workspace_id
          AND status = 'active';

        v_compatibility_role := CASE
          WHEN v_next_membership_role = 'workspace_owner' THEN 'admin'
          ELSE v_next_membership_role
        END;
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type type
          JOIN pg_enum enum ON enum.enumtypid = type.oid
          JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
          WHERE namespace.nspname = 'public'
            AND type.typname = 'user_role'
            AND enum.enumlabel = v_compatibility_role
        ) THEN
          v_compatibility_role := 'manager';
        END IF;

        UPDATE public.profiles
        SET role = v_compatibility_role::public.user_role,
            active_workspace_id = v_next_workspace_id
        WHERE id = p_user_id;
      END IF;
    END IF;

    RETURN 'suspended';
  END IF;

  v_should_make_default := v_profile_role = 'pending'
    OR NOT v_has_valid_active_workspace
    OR NOT EXISTS (
      SELECT 1
      FROM public.workspace_memberships
      WHERE user_id = p_user_id
        AND status = 'active'
        AND is_default
    );

  IF v_profile_role = 'pending' OR NOT v_has_valid_active_workspace THEN
    UPDATE public.workspace_memberships
    SET is_default = FALSE
    WHERE user_id = p_user_id
      AND is_default;
    v_should_make_default := TRUE;
  END IF;

  UPDATE public.workspace_memberships
  SET role = v_role,
      status = 'active',
      is_default = CASE WHEN v_should_make_default THEN TRUE ELSE is_default END,
      updated_at = NOW()
  WHERE workspace_id = p_workspace_id
    AND user_id = p_user_id;

  IF v_profile_role = 'pending'
     OR NOT v_has_valid_active_workspace
     OR v_active_workspace_id = p_workspace_id THEN
    v_compatibility_role := CASE
      WHEN v_role = 'workspace_owner' THEN 'admin'
      ELSE v_role
    END;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_type type
      JOIN pg_enum enum ON enum.enumtypid = type.oid
      JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname = 'public'
        AND type.typname = 'user_role'
        AND enum.enumlabel = v_compatibility_role
    ) THEN
      v_compatibility_role := 'manager';
    END IF;

    UPDATE public.profiles
    SET role = v_compatibility_role::public.user_role,
        active_workspace_id = CASE
          WHEN v_profile_role = 'pending' OR NOT v_has_valid_active_workspace
            THEN p_workspace_id
          ELSE active_workspace_id
        END
    WHERE id = p_user_id;
  END IF;

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.set_workspace_member_role(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_member_role(uuid, uuid, text, uuid)
  TO service_role;

-- Role lifecycle and permission-matrix writes must go through the service-only
-- atomic RPCs above. Browser sessions retain only the SELECT access needed for
-- their own navigation bootstrap.
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.workspace_memberships
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.workspace_role_permissions
  FROM anon, authenticated;

-- Shopee data is also server-only. Remove the old browser policies based on
-- Marketing/admin:meta; service-role server actions continue to bypass RLS.
DO $$
DECLARE
  v_table text;
  v_policy text;
  v_prefix text;
  v_legacy_policies text[];
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'shopee_shops',
    'shopee_ads_daily_metrics',
    'shopee_sync_log',
    'shopee_shop_spend_streams',
    'shopee_ad_campaigns',
    'shopee_ad_campaign_daily_metrics',
    'shopee_gms_campaign_period_metrics',
    'shopee_gms_item_period_metrics'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    v_prefix := CASE v_table
      WHEN 'shopee_ad_campaign_daily_metrics' THEN 'shopee_ad_campaign_metrics_scope'
      WHEN 'shopee_gms_campaign_period_metrics' THEN 'shopee_gms_campaign_scope'
      WHEN 'shopee_gms_item_period_metrics' THEN 'shopee_gms_item_scope'
      WHEN 'shopee_shop_spend_streams' THEN 'shopee_spend_streams_scope'
      WHEN 'shopee_ads_daily_metrics' THEN 'shopee_daily_metrics_scope'
      ELSE v_table || '_scope'
    END;

    v_legacy_policies := CASE v_table
      WHEN 'shopee_shops' THEN ARRAY[
        'Write shopee_shops via admin:meta'
      ]
      WHEN 'shopee_ads_daily_metrics' THEN ARRAY[
        'Write shopee_ads_daily_metrics via admin:meta'
      ]
      WHEN 'shopee_sync_log' THEN ARRAY[
        'Write shopee_sync_log via admin:meta'
      ]
      WHEN 'shopee_shop_spend_streams' THEN ARRAY[
        'Write shopee_shop_spend_streams via admin:meta'
      ]
      WHEN 'shopee_ad_campaigns' THEN ARRAY[
        'shopee_ad_campaigns_workspace_select',
        'shopee_ad_campaigns_workspace_write',
        'shopee_ad_campaigns_workspace_insert',
        'shopee_ad_campaigns_workspace_update',
        'shopee_ad_campaigns_workspace_delete'
      ]
      WHEN 'shopee_ad_campaign_daily_metrics' THEN ARRAY[
        'shopee_ad_campaign_metrics_workspace_select',
        'shopee_ad_campaign_metrics_workspace_write',
        'shopee_ad_campaign_metrics_workspace_insert',
        'shopee_ad_campaign_metrics_workspace_update',
        'shopee_ad_campaign_metrics_workspace_delete'
      ]
      WHEN 'shopee_gms_campaign_period_metrics' THEN ARRAY[
        'shopee_gms_campaign_period_workspace_select',
        'shopee_gms_campaign_period_workspace_write',
        'shopee_gms_campaign_period_workspace_insert',
        'shopee_gms_campaign_period_workspace_update',
        'shopee_gms_campaign_period_workspace_delete'
      ]
      ELSE ARRAY[
        'shopee_gms_item_period_workspace_select',
        'shopee_gms_item_period_workspace_write',
        'shopee_gms_item_period_workspace_insert',
        'shopee_gms_item_period_workspace_update',
        'shopee_gms_item_period_workspace_delete'
      ]
    END;

    v_legacy_policies := v_legacy_policies || ARRAY[
      v_prefix || '_select',
      v_prefix || '_select_gate',
      v_prefix || '_insert',
      v_prefix || '_update',
      v_prefix || '_delete'
    ];

    FOREACH v_policy IN ARRAY v_legacy_policies
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy, v_table);
    END LOOP;

    -- All Shopee reads and mutations in the application use the service role
    -- after a server-side Shopee Details/admin:shopee check.
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM anon, authenticated',
      v_table
    );
  END LOOP;
END
$$;

-- OAuth tokens are never exposed to a browser session. Application server
-- actions read them through the service role after their own permission check.
DO $$
DECLARE
  v_policy text;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shopee_shop_tokens'
      AND permissive = 'PERMISSIVE'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.shopee_shop_tokens',
      v_policy
    );
  END LOOP;
END
$$;

REVOKE ALL ON TABLE public.shopee_shop_tokens FROM anon, authenticated;

COMMIT;
