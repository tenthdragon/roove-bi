-- Fixed local Docker clone only; no fixture survives.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'Local clone marker required'; END IF;
 IF EXISTS(SELECT 1 FROM meta_ad_destination_metadata WHERE ad_id LIKE '99999997000%') THEN RAISE EXCEPTION 'Fixture collision'; END IF;
END $$;
CREATE TEMP TABLE catalog_priority_scope AS
 SELECT '00000000-0000-4000-8000-000000000001'::uuid AS w,
 (SELECT id FROM workspaces WHERE id<>'00000000-0000-4000-8000-000000000001' LIMIT 1) AS other_w;
INSERT INTO meta_shopee_product_sets(workspace_id,account_id,product_set_id,verification)
 SELECT w,'act_999999970001','999999970001','{"complete":true,"product_count":1}' FROM catalog_priority_scope;
INSERT INTO meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,adset_id,metadata,classification,evidence,observed_at)
SELECT CASE n WHEN 4 THEN other_w ELSE w END,
 CASE n WHEN 3 THEN 'act_999999970002' ELSE 'act_999999970001' END,'99999997000'||n,'10','20',
 jsonb_build_object('urls',jsonb_build_array('https://roove.co.id/a'),'product_set_ids',CASE n WHEN 2 THEN '["999999970002"]'::jsonb WHEN 5 THEN '[]'::jsonb ELSE '["999999970001"]'::jsonb END),
 CASE n WHEN 6 THEN 'cpas' ELSE 'unknown' END,
 '[{"type":"verified_product_set_id","value":"999999970001"},{"type":"conflicting_website_url","value":"https://roove.co.id/a"}]',
 '2026-10-01T00:00:00Z'
FROM catalog_priority_scope CROSS JOIN generate_series(1,6) n;
CREATE TEMP TABLE catalog_priority_before AS SELECT * FROM meta_ad_destination_metadata WHERE ad_id LIKE '99999997000%';
CREATE TEMP TABLE catalog_priority_metrics AS SELECT count(*) n,coalesce(sum((metrics->>'spend')::numeric),0) spent FROM meta_ad_daily_metrics;
-- APPLY_CATALOG_PRIORITY_MIGRATION
DO $$ DECLARE w uuid; r record; BEGIN
 SELECT s.w INTO w FROM catalog_priority_scope s;
 FOR r IN SELECT d.*,b.classification previous_classification,b.evidence previous_evidence FROM meta_ad_destination_metadata d JOIN catalog_priority_before b USING(workspace_id,account_id,ad_id) LOOP
  IF r.ad_id='999999970001' THEN
   IF r.classification<>'cpas' OR r.evidence<>'[{"type":"verified_product_set_id","value":"999999970001"}]'::jsonb THEN RAISE EXCEPTION 'Verified Shopee catalog with brand URL was not repaired'; END IF;
  ELSIF r.classification<>r.previous_classification OR r.evidence<>r.previous_evidence THEN RAISE EXCEPTION 'Cross-workspace/account, unverified, absent-set or existing-CPAS row was changed'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM meta_ad_destination_metadata d JOIN catalog_priority_before b USING(workspace_id,account_id,ad_id)
  WHERE (to_jsonb(d)-'classification'-'evidence') IS DISTINCT FROM (to_jsonb(b)-'classification'-'evidence')) THEN RAISE EXCEPTION 'Repair overwrote observation fields'; END IF;
 IF (SELECT row(count(*),coalesce(sum((metrics->>'spend')::numeric),0)) FROM meta_ad_daily_metrics) IS DISTINCT FROM (SELECT row(n,spent) FROM catalog_priority_metrics) THEN RAISE EXCEPTION 'Repair changed spend/facts'; END IF;
 IF meta_ad_channel_bucket('cpas','[{"type":"verified_product_set_id","value":"999999970001"}]','{"urls":["https://roove.co.id/a"],"product_set_ids":["999999970001"]}','10','10')<>'cpas' THEN RAISE EXCEPTION 'UI still rejects catalog with brand URL'; END IF;
END $$;
CREATE TEMP TABLE catalog_priority_after AS SELECT * FROM meta_ad_destination_metadata WHERE ad_id LIKE '99999997000%';
-- APPLY_CATALOG_PRIORITY_MIGRATION
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM meta_ad_destination_metadata d JOIN catalog_priority_after b USING(workspace_id,account_id,ad_id) WHERE to_jsonb(d) IS DISTINCT FROM to_jsonb(b)) THEN RAISE EXCEPTION 'Repair is not idempotent'; END IF;
END $$;
SELECT 'PASS: catalog priority repair, workspace/account scope, observed product IDs, unchanged URLs/identity/time/spend, idempotence, and UI membership';
ROLLBACK;
