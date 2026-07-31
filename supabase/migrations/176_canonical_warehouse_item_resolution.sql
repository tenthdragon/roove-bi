-- ============================================================================
-- 176: Canonical warehouse item resolution for the daily deduction guardrail
-- ============================================================================
-- Owner Item Mapping is the canonical source of truth. Stable ScaleV catalog
-- identifiers resolve to the canonical owner mapping first. The old exact-name
-- table and warehouse product aliases remain read-only compatibility fallbacks
-- for historical order lines that do not carry a usable catalog identity.
--
-- This migration only replaces a read function. It does not update, delete or
-- insert warehouse ledger rows.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.warehouse_daily_undeducted_orders(
  p_workspace_id uuid,
  p_date date,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  order_id text,
  business_code text,
  product_lines jsonb,
  problem text,
  problem_detail text,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (p_date::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_start,
      ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_end
  ),
  orders AS (
    SELECT
      order_row.id,
      order_row.order_id,
      COALESCE(
        NULLIF(TRIM(order_row.seller_business_code), ''),
        seller_directory.business_code,
        order_row.business_code
      ) AS business_code,
      order_row.shipped_time,
      origin.internal_warehouse_code
    FROM public.scalev_orders order_row
    CROSS JOIN bounds
    LEFT JOIN public.warehouse_business_directory seller_directory
      ON seller_directory.workspace_id = p_workspace_id
     AND seller_directory.is_active = true
     AND seller_directory.external_name_normalized = LOWER(
       TRIM(REGEXP_REPLACE(COALESCE(order_row.business_name_raw, ''), '[[:space:]]+', ' ', 'g'))
     )
    LEFT JOIN LATERAL (
      SELECT registry.internal_warehouse_code
      FROM public.warehouse_origin_registry registry
      WHERE registry.workspace_id = p_workspace_id
        AND registry.is_active = true
        AND (
          registry.id = order_row.origin_registry_id
          OR (
            registry.external_origin_business_name_normalized = LOWER(
              TRIM(REGEXP_REPLACE(COALESCE(order_row.origin_business_name_raw, ''), '[[:space:]]+', ' ', 'g'))
            )
            AND registry.external_origin_name_normalized = LOWER(
              TRIM(REGEXP_REPLACE(COALESCE(order_row.origin_raw, ''), '[[:space:]]+', ' ', 'g'))
            )
          )
        )
      ORDER BY CASE WHEN registry.id = order_row.origin_registry_id THEN 0 ELSE 1 END, registry.id
      LIMIT 1
    ) origin ON true
    WHERE order_row.workspace_id = p_workspace_id
      AND order_row.status IN ('shipped', 'completed')
      AND order_row.shipped_time >= bounds.day_start
      AND order_row.shipped_time < bounds.day_end
  ),
  mapping_allowed AS (
    SELECT
      mapping.business_code,
      mapping.deduct_entity,
      COALESCE(mapping.deduct_warehouse, 'BTN') AS deduct_warehouse,
      COALESCE(mapping.is_primary, false) AS is_primary
    FROM public.warehouse_business_mapping mapping
    WHERE mapping.workspace_id = p_workspace_id
      AND mapping.is_active = true
  ),
  mapping_summary AS (
    SELECT
      business_code,
      COALESCE(MAX(deduct_entity) FILTER (WHERE is_primary), MIN(deduct_entity)) AS primary_entity,
      COALESCE(MAX(deduct_warehouse) FILTER (WHERE is_primary), MIN(deduct_warehouse)) AS primary_warehouse,
      string_agg(
        CASE
          WHEN is_primary THEN format('%s • %s (utama)', deduct_entity, deduct_warehouse)
          ELSE format('%s • %s', deduct_entity, deduct_warehouse)
        END,
        ', '
        ORDER BY is_primary DESC, deduct_entity, deduct_warehouse
      ) AS allowed_targets
    FROM mapping_allowed
    GROUP BY business_code
  ),
  line_base AS (
    SELECT
      line.id AS line_id,
      order_row.id AS scalev_order_id,
      order_row.order_id,
      order_row.business_code,
      line.product_name,
      line.variant_sku,
      COALESCE(
        NULLIF(TRIM(line.stock_owner_business_code), ''),
        owner_directory.business_code
      ) AS stock_owner_business_code,
      order_row.internal_warehouse_code,
      line.quantity::numeric AS quantity
    FROM orders order_row
    JOIN public.scalev_order_lines line
      ON line.workspace_id = p_workspace_id
     AND line.scalev_order_id = order_row.id
    LEFT JOIN public.warehouse_business_directory owner_directory
      ON owner_directory.workspace_id = p_workspace_id
     AND owner_directory.is_active = true
     AND owner_directory.external_name_normalized = LOWER(
       TRIM(REGEXP_REPLACE(COALESCE(line.item_owner_raw, ''), '[[:space:]]+', ' ', 'g'))
     )
    WHERE line.product_name IS NOT NULL
      AND line.product_name <> ''
      AND COALESCE(line.quantity, 0) > 0
  ),
  line_rollup AS (
    SELECT
      scalev_order_id,
      order_id,
      product_name,
      SUM(quantity)::numeric AS quantity
    FROM line_base
    GROUP BY scalev_order_id, order_id, product_name
  ),
  product_lines AS (
    SELECT
      order_row.order_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'product_name', line_rollup.product_name,
            'quantity', line_rollup.quantity
          )
          ORDER BY line_rollup.product_name
        ) FILTER (WHERE line_rollup.product_name IS NOT NULL),
        '[]'::jsonb
      ) AS product_lines,
      COUNT(line_rollup.product_name) AS line_count
    FROM orders order_row
    LEFT JOIN line_rollup
      ON line_rollup.scalev_order_id = order_row.id
    GROUP BY order_row.order_id
  ),
  viewer_business AS (
    SELECT
      order_row.order_id,
      business.id AS business_id
    FROM orders order_row
    JOIN public.scalev_webhook_businesses business
      ON business.workspace_id = p_workspace_id
     AND business.business_code = order_row.business_code
     AND business.is_active = true
  ),
  line_identifier_candidates AS (
    SELECT DISTINCT
      line.line_id,
      line.order_id,
      line.business_code,
      line.product_name,
      line.quantity,
      candidate.identifier_normalized,
      candidate.candidate_priority,
      candidate.candidate_mode
    FROM line_base line
    CROSS JOIN LATERAL (
      VALUES
        (
          LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(line.variant_sku, ''), '[^a-zA-Z0-9]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))),
          390,
          'variant_sku'
        ),
        (
          LOWER(TRIM(REGEXP_REPLACE(COALESCE(line.variant_sku, ''), '[[:space:]]+', ' ', 'g'))),
          400,
          'variant_sku'
        ),
        (
          LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(line.product_name, ''), '[^a-zA-Z0-9]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))),
          190,
          'product_name'
        ),
        (
          LOWER(TRIM(REGEXP_REPLACE(COALESCE(line.product_name, ''), '[[:space:]]+', ' ', 'g'))),
          200,
          'product_name'
        )
    ) AS candidate(identifier_normalized, candidate_priority, candidate_mode)
    WHERE candidate.identifier_normalized <> ''
  ),
  ranked_catalog_entities AS (
    SELECT
      candidate.line_id,
      candidate.order_id,
      candidate.business_code,
      candidate.product_name,
      candidate.quantity,
      identifier.business_id AS viewer_business_id,
      identifier.entity_type,
      identifier.entity_key,
      identifier.owner_business_id,
      identifier.owner_business_code,
      ROW_NUMBER() OVER (
        PARTITION BY candidate.line_id
        ORDER BY
          candidate.candidate_priority DESC,
          CASE
            WHEN candidate.candidate_mode = 'variant_sku' AND identifier.source = 'variant.unique_id' THEN 100
            WHEN candidate.candidate_mode = 'variant_sku' AND identifier.source = 'bundle.price_option_unique_id' THEN 96
            WHEN candidate.candidate_mode = 'variant_sku' AND identifier.source = 'bundle.price_option_slug' THEN 94
            WHEN candidate.candidate_mode = 'variant_sku' AND identifier.source = 'bundle.custom_id' THEN 92
            WHEN candidate.candidate_mode = 'variant_sku' AND identifier.source = 'variant.sku' THEN 90
            WHEN candidate.candidate_mode = 'variant_sku' AND identifier.source = 'variant.uuid' THEN 80
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'bundle.custom_id' THEN 99
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'bundle.price_option_unique_id' THEN 97
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'bundle.price_option_slug' THEN 95
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'bundle.display' THEN 93
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'bundle.public_name' THEN 91
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'variant.name' THEN 90
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'bundle.name' THEN 89
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'product.display' THEN 80
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'product.public_name' THEN 75
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'product.name' THEN 70
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'variant.product_name' THEN 55
            WHEN candidate.candidate_mode = 'product_name' AND identifier.source = 'product.slug' THEN 35
            ELSE 10
          END DESC,
          CASE identifier.entity_type
            WHEN 'variant' THEN 30
            WHEN 'product' THEN 20
            WHEN 'bundle' THEN 10
            ELSE 0
          END DESC,
          identifier.entity_key
      ) AS entity_rank
    FROM line_identifier_candidates candidate
    JOIN viewer_business viewer
      ON viewer.order_id = candidate.order_id
    JOIN public.scalev_catalog_identifiers identifier
     ON identifier.workspace_id = p_workspace_id
     AND identifier.business_id = viewer.business_id
     AND identifier.identifier_normalized = candidate.identifier_normalized
    WHERE NOT (
      candidate.candidate_mode = 'variant_sku'
      AND identifier.entity_type = 'product'
    )
  ),
  catalog_entities AS (
    SELECT
      line_id,
      order_id,
      business_code,
      product_name,
      quantity,
      viewer_business_id,
      entity_type,
      entity_key,
      owner_business_id,
      owner_business_code,
      entity_rank
    FROM ranked_catalog_entities
  ),
  direct_catalog_raw_targets AS (
    SELECT
      entity.line_id,
      entity.entity_rank,
      entity.order_id,
      entity.business_code,
      entity.product_name,
      mapping.warehouse_product_id,
      entity.quantity AS desired_qty,
      product.entity AS target_entity,
      COALESCE(product.warehouse, 'BTN') AS target_warehouse,
      (product.owner_workspace_id = p_workspace_id AND product.is_active = true) AS target_product_valid,
      COALESCE(
        NULLIF(TRIM(line.stock_owner_business_code), ''),
        direct_owner.owner_business_code,
        entity.owner_business_code
      ) AS owner_business_code,
      line.internal_warehouse_code,
      'canonical'::text AS resolution_source
    FROM catalog_entities entity
    LEFT JOIN LATERAL (
      SELECT owner_candidate.owner_business_id, owner_candidate.owner_business_code
      FROM (
        SELECT variant.owner_business_id, variant.owner_business_code
        FROM public.scalev_catalog_variants variant
        WHERE variant.workspace_id = p_workspace_id
          AND variant.business_id = entity.viewer_business_id
          AND entity.entity_key = format('variant:%s', variant.scalev_variant_id)

        UNION ALL

        SELECT product_entity.owner_business_id, product_entity.owner_business_code
        FROM public.scalev_catalog_products product_entity
        WHERE product_entity.workspace_id = p_workspace_id
          AND product_entity.business_id = entity.viewer_business_id
          AND entity.entity_key = format('product:%s', product_entity.scalev_product_id)
      ) owner_candidate
      LIMIT 1
    ) direct_owner ON true
    JOIN public.warehouse_scalev_catalog_mapping mapping
      ON mapping.workspace_id = p_workspace_id
     AND mapping.business_id = COALESCE(direct_owner.owner_business_id, entity.owner_business_id)
     AND mapping.scalev_entity_key = entity.entity_key
     AND mapping.warehouse_product_id IS NOT NULL
    JOIN public.warehouse_products product
      ON product.id = mapping.warehouse_product_id
    JOIN line_base line
      ON line.line_id = entity.line_id
    WHERE entity.entity_type IN ('product', 'variant')
  ),
  bundle_components AS (
    SELECT
      entity.line_id,
      entity.entity_rank,
      entity.order_id,
      entity.business_code,
      entity.product_name,
      entity.quantity,
      entity.viewer_business_id,
      line.internal_warehouse_code,
      line.stock_owner_business_code,
      bundle_line.scalev_bundle_line_key,
      bundle_line.quantity::numeric AS component_multiplier,
      CASE
        WHEN bundle_line.scalev_variant_id IS NOT NULL THEN format('variant:%s', bundle_line.scalev_variant_id)
        WHEN bundle_line.scalev_product_id IS NOT NULL THEN format('product:%s', bundle_line.scalev_product_id)
        ELSE NULL
      END AS component_entity_key
    FROM catalog_entities entity
    JOIN line_base line
      ON line.line_id = entity.line_id
    JOIN public.scalev_catalog_bundle_lines bundle_line
      ON bundle_line.workspace_id = p_workspace_id
     AND bundle_line.business_id = entity.viewer_business_id
     AND format('bundle:%s', bundle_line.scalev_bundle_id) = entity.entity_key
    WHERE entity.entity_type = 'bundle'
  ),
  bundle_component_mappings AS (
    SELECT
      component.*,
      resolved.warehouse_product_id,
      resolved.target_entity,
      resolved.target_warehouse,
      resolved.target_product_valid,
      resolved.owner_business_code
    FROM bundle_components component
    LEFT JOIN LATERAL (
      SELECT
        mapping.warehouse_product_id,
        product.entity AS target_entity,
        COALESCE(product.warehouse, 'BTN') AS target_warehouse,
        (product.owner_workspace_id = p_workspace_id AND product.is_active = true) AS target_product_valid,
        component_owner.owner_business_code
      FROM public.warehouse_scalev_catalog_mapping mapping
      JOIN public.warehouse_products product
        ON product.id = mapping.warehouse_product_id
      JOIN LATERAL (
        SELECT owner_candidate.owner_business_id, owner_candidate.owner_business_code
        FROM (
          SELECT
            variant.owner_business_id,
            variant.owner_business_code,
            variant.business_id
          FROM public.scalev_catalog_variants variant
          WHERE variant.workspace_id = p_workspace_id
            AND component.component_entity_key = format('variant:%s', variant.scalev_variant_id)

          UNION ALL

          SELECT
            product_entity.owner_business_id,
            product_entity.owner_business_code,
            product_entity.business_id
          FROM public.scalev_catalog_products product_entity
          WHERE product_entity.workspace_id = p_workspace_id
            AND component.component_entity_key = format('product:%s', product_entity.scalev_product_id)
        ) owner_candidate
        ORDER BY
          CASE WHEN owner_candidate.business_id = component.viewer_business_id THEN 0 ELSE 1 END,
          owner_candidate.business_id
        LIMIT 1
      ) component_owner ON true
      WHERE mapping.workspace_id = p_workspace_id
        AND mapping.business_id = component_owner.owner_business_id
        AND mapping.scalev_entity_key = component.component_entity_key
        AND mapping.warehouse_product_id IS NOT NULL
      ORDER BY mapping.id
      LIMIT 1
    ) resolved ON true
  ),
  bundle_resolution_counts AS (
    SELECT
      line_id,
      entity_rank,
      COUNT(*) AS component_count,
      COUNT(warehouse_product_id) AS resolved_component_count
    FROM bundle_component_mappings
    GROUP BY line_id, entity_rank
  ),
  bundle_catalog_raw_targets AS (
    SELECT
      component.line_id,
      component.entity_rank,
      component.order_id,
      component.business_code,
      component.product_name,
      component.warehouse_product_id,
      component.quantity * component.component_multiplier AS desired_qty,
      component.target_entity,
      component.target_warehouse,
      component.target_product_valid,
      COALESCE(
        NULLIF(TRIM(component.stock_owner_business_code), ''),
        component.owner_business_code
      ) AS owner_business_code,
      component.internal_warehouse_code,
      'canonical_bundle'::text AS resolution_source
    FROM bundle_component_mappings component
    JOIN bundle_resolution_counts counts
      ON counts.line_id = component.line_id
     AND counts.entity_rank = component.entity_rank
     AND counts.component_count = counts.resolved_component_count
    WHERE component.warehouse_product_id IS NOT NULL
  ),
  catalog_raw_targets AS (
    SELECT * FROM direct_catalog_raw_targets
    UNION ALL
    SELECT * FROM bundle_catalog_raw_targets
  ),
  catalog_target_validity AS (
    SELECT
      target.line_id,
      target.entity_rank,
      COUNT(*) AS target_count,
      COUNT(*) FILTER (
        WHERE (
          target.target_product_valid
          AND target.internal_warehouse_code IS NOT NULL
          AND target.owner_business_code IS NOT NULL
          AND target.target_entity = target.owner_business_code
          AND target.target_warehouse = target.internal_warehouse_code
        )
        OR (
          target.target_product_valid
          AND target.internal_warehouse_code IS NULL
          AND EXISTS (
            SELECT 1
            FROM mapping_allowed allowed
            WHERE allowed.business_code = target.business_code
              AND allowed.deduct_entity = target.target_entity
              AND allowed.deduct_warehouse = target.target_warehouse
          )
        )
      ) AS valid_target_count
    FROM catalog_raw_targets target
    GROUP BY target.line_id, target.entity_rank
  ),
  selected_catalog_entity_rank AS (
    SELECT
      line_id,
      MIN(entity_rank) AS entity_rank
    FROM catalog_target_validity
    GROUP BY line_id
  ),
  catalog_targets AS (
    SELECT target.*
    FROM catalog_raw_targets target
    JOIN selected_catalog_entity_rank selected
      ON selected.line_id = target.line_id
     AND selected.entity_rank = target.entity_rank
    JOIN catalog_target_validity validity
      ON validity.line_id = target.line_id
     AND validity.entity_rank = target.entity_rank
     AND validity.target_count = validity.valid_target_count
  ),
  fallback_targets AS (
    SELECT
      line.line_id,
      line.order_id,
      line.business_code,
      line.product_name,
      COALESCE(
        CASE
          WHEN legacy_product.id IS NOT NULL
           AND (
             (
               line.internal_warehouse_code IS NOT NULL
               AND line.stock_owner_business_code IS NOT NULL
               AND legacy_product.entity = line.stock_owner_business_code
               AND COALESCE(legacy_product.warehouse, 'BTN') = line.internal_warehouse_code
             )
             OR (
               line.internal_warehouse_code IS NULL
               AND EXISTS (
                 SELECT 1
                 FROM mapping_allowed allowed
                 WHERE allowed.business_code = line.business_code
                   AND allowed.deduct_entity = legacy_product.entity
                   AND allowed.deduct_warehouse = COALESCE(legacy_product.warehouse, 'BTN')
               )
             )
           )
          THEN legacy_mapping.warehouse_product_id
          ELSE NULL
        END,
        alias_product.warehouse_product_id
      ) AS warehouse_product_id,
      line.quantity * CASE
        WHEN legacy_product.id IS NOT NULL
         AND (
           (
             line.internal_warehouse_code IS NOT NULL
             AND line.stock_owner_business_code IS NOT NULL
             AND legacy_product.entity = line.stock_owner_business_code
             AND COALESCE(legacy_product.warehouse, 'BTN') = line.internal_warehouse_code
           )
           OR (
             line.internal_warehouse_code IS NULL
             AND EXISTS (
               SELECT 1
               FROM mapping_allowed allowed
               WHERE allowed.business_code = line.business_code
                 AND allowed.deduct_entity = legacy_product.entity
                 AND allowed.deduct_warehouse = COALESCE(legacy_product.warehouse, 'BTN')
             )
           )
         )
        THEN COALESCE(legacy_mapping.deduct_qty_multiplier, 1)::numeric
        ELSE 1::numeric
      END AS desired_qty,
      CASE
        WHEN legacy_product.id IS NOT NULL THEN 'compatibility_name'
        WHEN alias_product.warehouse_product_id IS NOT NULL THEN 'product_alias'
        ELSE NULL
      END AS resolution_source,
      COALESCE(legacy_mapping.is_ignored, false) AS is_ignored
    FROM line_base line
    LEFT JOIN public.warehouse_scalev_mapping legacy_mapping
      ON legacy_mapping.workspace_id = p_workspace_id
     AND legacy_mapping.scalev_product_name = line.product_name
    LEFT JOIN public.warehouse_products legacy_product
      ON legacy_product.id = legacy_mapping.warehouse_product_id
     AND legacy_product.owner_workspace_id = p_workspace_id
     AND legacy_product.is_active = true
    LEFT JOIN LATERAL (
      SELECT product.id AS warehouse_product_id
      FROM public.warehouse_products product
      WHERE product.owner_workspace_id = p_workspace_id
        AND product.is_active = true
        AND product.scalev_product_names @> ARRAY[line.product_name]::text[]
        AND (
          (
            line.internal_warehouse_code IS NOT NULL
            AND line.stock_owner_business_code IS NOT NULL
            AND product.entity = line.stock_owner_business_code
            AND COALESCE(product.warehouse, 'BTN') = line.internal_warehouse_code
          )
          OR (
            line.internal_warehouse_code IS NULL
            AND EXISTS (
              SELECT 1
              FROM mapping_allowed allowed
              WHERE allowed.business_code = line.business_code
                AND allowed.deduct_entity = product.entity
                AND allowed.deduct_warehouse = COALESCE(product.warehouse, 'BTN')
            )
          )
        )
      ORDER BY product.id
      LIMIT 1
    ) alias_product ON true
    WHERE NOT EXISTS (
      SELECT 1
      FROM catalog_raw_targets canonical
      WHERE canonical.line_id = line.line_id
    )
  ),
  resolved_targets AS (
    SELECT
      line_id,
      order_id,
      business_code,
      product_name,
      warehouse_product_id,
      desired_qty,
      resolution_source
    FROM catalog_targets

    UNION ALL

    SELECT
      line_id,
      order_id,
      business_code,
      product_name,
      warehouse_product_id,
      desired_qty,
      resolution_source
    FROM fallback_targets
    WHERE warehouse_product_id IS NOT NULL
      AND is_ignored = false
  ),
  desired AS (
    SELECT
      order_id,
      warehouse_product_id,
      SUM(desired_qty)::numeric AS desired_qty
    FROM resolved_targets
    GROUP BY order_id, warehouse_product_id
  ),
  unmapped AS (
    SELECT
      line.order_id,
      string_agg(DISTINCT line.product_name, ', ' ORDER BY line.product_name) AS unmapped_products
    FROM line_base line
    LEFT JOIN fallback_targets fallback
      ON fallback.line_id = line.line_id
    WHERE NOT COALESCE(fallback.is_ignored, false)
      AND NOT EXISTS (
        SELECT 1
        FROM resolved_targets target
        WHERE target.line_id = line.line_id
      )
    GROUP BY line.order_id
  ),
  ledger_net_source AS (
    SELECT
      order_row.order_id,
      ledger.warehouse_product_id,
      SUM(ledger.quantity)::numeric AS net_qty
    FROM public.warehouse_stock_ledger ledger
    JOIN orders order_row
      ON ledger.scalev_order_id = order_row.id
    WHERE ledger.reference_type = 'scalev_order'
      AND ledger.workspace_id = p_workspace_id
    GROUP BY order_row.order_id, ledger.warehouse_product_id

    UNION ALL

    SELECT
      order_row.order_id,
      ledger.warehouse_product_id,
      SUM(ledger.quantity)::numeric AS net_qty
    FROM public.warehouse_stock_ledger ledger
    JOIN orders order_row
      ON ledger.scalev_order_id IS NULL
     AND ledger.reference_id = order_row.order_id
    WHERE ledger.reference_type = 'scalev_order'
      AND ledger.workspace_id = p_workspace_id
    GROUP BY order_row.order_id, ledger.warehouse_product_id
  ),
  ledger_net AS (
    SELECT
      order_id,
      warehouse_product_id,
      SUM(net_qty)::numeric AS net_qty
    FROM ledger_net_source
    GROUP BY order_id, warehouse_product_id
  ),
  outstanding AS (
    SELECT
      order_id,
      warehouse_product_id,
      ABS(net_qty)::numeric AS outstanding_qty
    FROM ledger_net
    WHERE net_qty < -0.000001
  ),
  mismatch AS (
    SELECT DISTINCT
      COALESCE(desired.order_id, outstanding.order_id) AS order_id
    FROM desired
    FULL OUTER JOIN outstanding
      ON outstanding.order_id = desired.order_id
     AND outstanding.warehouse_product_id = desired.warehouse_product_id
    WHERE ABS(COALESCE(desired.desired_qty, 0) - COALESCE(outstanding.outstanding_qty, 0)) > 0.000001
  ),
  issues AS (
    SELECT
      order_row.order_id,
      order_row.business_code,
      COALESCE(product_lines.product_lines, '[]'::jsonb) AS product_lines,
      CASE
        WHEN order_row.internal_warehouse_code IS NULL
         AND mapping_summary.business_code IS NULL THEN 'no_business_mapping'
        WHEN COALESCE(product_lines.line_count, 0) = 0 THEN 'no_order_lines'
        WHEN unmapped.unmapped_products IS NOT NULL THEN 'no_product_mapping'
        WHEN mismatch.order_id IS NOT NULL THEN 'unknown'
        ELSE NULL
      END AS problem,
      CASE
        WHEN order_row.internal_warehouse_code IS NULL
         AND mapping_summary.business_code IS NULL THEN format('Business %s tidak punya warehouse mapping', COALESCE(order_row.business_code, '-'))
        WHEN COALESCE(product_lines.line_count, 0) = 0 THEN format('Order %s tidak punya order lines', order_row.order_id)
        WHEN unmapped.unmapped_products IS NOT NULL THEN format(
          'Item belum memiliki canonical mapping yang valid (%s): %s',
          COALESCE(
            mapping_summary.allowed_targets,
            CASE
              WHEN order_row.internal_warehouse_code IS NOT NULL
                THEN format('owner item • %s (warehouse registry)', order_row.internal_warehouse_code)
              ELSE '-'
            END
          ),
          unmapped.unmapped_products
        )
        WHEN mismatch.order_id IS NOT NULL THEN 'Deduction warehouse belum sinkron dengan canonical item mapping'
        ELSE NULL
      END AS problem_detail,
      CASE
        WHEN order_row.internal_warehouse_code IS NULL
         AND mapping_summary.business_code IS NULL THEN 1
        WHEN unmapped.unmapped_products IS NOT NULL THEN 2
        WHEN COALESCE(product_lines.line_count, 0) = 0 THEN 3
        WHEN mismatch.order_id IS NOT NULL THEN 4
        ELSE 99
      END AS problem_rank,
      order_row.shipped_time
    FROM orders order_row
    LEFT JOIN mapping_summary
      ON mapping_summary.business_code = order_row.business_code
    LEFT JOIN product_lines
      ON product_lines.order_id = order_row.order_id
    LEFT JOIN unmapped
      ON unmapped.order_id = order_row.order_id
    LEFT JOIN mismatch
      ON mismatch.order_id = order_row.order_id
  ),
  paged AS (
    SELECT
      order_id,
      business_code,
      product_lines,
      problem,
      problem_detail,
      COUNT(*) OVER() AS total_count,
      problem_rank,
      shipped_time
    FROM issues
    WHERE problem IS NOT NULL
    ORDER BY problem_rank, shipped_time DESC, order_id DESC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
    paged.order_id,
    paged.business_code,
    paged.product_lines,
    paged.problem,
    paged.problem_detail,
    paged.total_count
  FROM paged;
$$;

REVOKE ALL ON FUNCTION public.warehouse_daily_undeducted_orders(uuid, date, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.warehouse_daily_undeducted_orders(uuid, date, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.warehouse_daily_undeducted_orders(uuid, date, integer, integer) IS
  'Tenant-aware daily deduction guardrail. Resolves canonical owner item mappings first and uses exact-name mappings only as a compatibility fallback. Read-only; never mutates ledger history.';

COMMIT;
