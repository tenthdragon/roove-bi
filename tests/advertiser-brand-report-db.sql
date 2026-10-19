CREATE FUNCTION pg_temp.assert_true(v boolean,m text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION '%',m; END IF; END $$;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; ids integer[]; one integer; grants integer[]; f jsonb; r jsonb; old jsonb; item jsonb; config jsonb; k text; BEGIN
 SELECT array_agg(DISTINCT default_brand_id) INTO ids FROM meta_ad_accounts a JOIN ctwa_scope s USING(workspace_id,account_id);
 PERFORM pg_temp.assert_true(cardinality(ids)=2,'Fixture needs two brands');
 FOREACH grants SLICE 1 IN ARRAY ARRAY[ids,ARRAY[ids[1],ids[1]],ARRAY[ids[2],ids[2]]] LOOP
  SELECT jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO config FROM meta_ad_accounts WHERE workspace_id=w AND is_active AND default_brand_id=ANY(grants);
  FOREACH f IN ARRAY ARRAY['{}','{"cep":"__unknown__"}','{"objective":"__unknown__"}','{"intention":"disc"}']::jsonb[] LOOP
   r:=get_meta_brand_overview_report_scoped(w,'1996-01-02','1996-01-02',f,grants);
   PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'reports') x WHERE NOT (x->>'brand')::int=ANY(grants)),'Foreign brand escaped reports');
   FOR item IN SELECT value FROM jsonb_array_elements(r->'reports') LOOP
    old:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,f||jsonb_build_object('channel',item->>'channel'),item->>'brand',CASE WHEN item->>'channel'='cpas' THEN 'ad' ELSE 'landing_page' END);
    FOREACH k IN ARRAY ARRAY['summary','previous','groups','matchingAds','currencies'] LOOP
     PERFORM pg_temp.assert_true(item->'report'->k=old->k,'Scoped report mismatch: '||k);
    END LOOP;
    PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(item#>'{report,coverage}') c WHERE NOT EXISTS(SELECT 1 FROM meta_ad_accounts a WHERE a.workspace_id=w AND a.account_id=c->>'account_id' AND a.default_brand_id=ANY(grants))),'Foreign coverage leaked');
   END LOOP;
   old:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,f||'{"channel":"non_cpas"}');
   PERFORM pg_temp.assert_true(r->'facetTotals'=old->'facetTotals' AND r->'cepLabels'=old->'cepLabels','Scoped facet totals or labels leaked');
   PERFORM pg_temp.assert_true(NOT EXISTS((SELECT value FROM jsonb_array_elements(r->'facets') EXCEPT SELECT value FROM jsonb_array_elements(old->'facets')) UNION ALL (SELECT value FROM jsonb_array_elements(old->'facets') EXCEPT SELECT value FROM jsonb_array_elements(r->'facets'))),'Scoped facet counts differ');
  END LOOP;
 END LOOP;
 FOREACH grants SLICE 1 IN ARRAY ARRAY[ARRAY[-999999],ARRAY[-999998]] LOOP
  r:=get_meta_brand_overview_report_scoped(w,'1996-01-02','1996-01-02','{}',grants);
  PERFORM pg_temp.assert_true(r->'reports'='[]' AND r->'cepSpend'='[]' AND r->'cepLabels'='{}' AND r->'facetTotals'='{}','Unknown grants exposed data');
 END LOOP;
 r:=get_meta_brand_overview_report_scoped(w,'1996-01-02','1996-01-02','{}','{}');
 PERFORM pg_temp.assert_true(r->'reports'='[]' AND r->'cepSpend'='[]' AND r->'cepLabels'='{}' AND r->'facetTotals'='{}','Empty grants became all brands');
 PERFORM pg_temp.assert_true(get_meta_brand_overview_report_scoped(w,'1996-01-02','1996-01-02','{}',NULL)=get_meta_brand_overview_report(w,'1996-01-02','1996-01-02','{}'),'Unrestricted parity lost');
 r:=get_meta_brand_overview_report_scoped('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02','{}',ids);
 PERFORM pg_temp.assert_true(r->'reports'='[]','Cross-workspace brand IDs exposed data');
END $$;
SELECT 'PASS: scoped incremental report parity, multi-brand/single-brand/empty scope, totals, facets, labels, coverage and tenant isolation';
RESET ROLE;
-- Verify the real transition-table trigger, not the dummy in the auth fixture.
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; u uuid; b integer; before_revision bigint; BEGIN
 SELECT user_id INTO STRICT u FROM workspace_memberships WHERE workspace_id=w LIMIT 1;
 SELECT min(id) INTO b FROM brands WHERE workspace_id=w;
 SELECT revision INTO before_revision FROM meta_ad_report_versions WHERE workspace_id=w;
 INSERT INTO workspace_advertiser_brands(workspace_id,user_id,brand_id) VALUES(w,u,b);
 PERFORM pg_temp.assert_true((SELECT revision>before_revision FROM meta_ad_report_versions WHERE workspace_id=w),'Assignment did not invalidate revision');
 SELECT revision INTO before_revision FROM meta_ad_report_versions WHERE workspace_id=w;
 DELETE FROM workspace_advertiser_brands WHERE workspace_id=w AND user_id=u;
 PERFORM pg_temp.assert_true((SELECT revision>before_revision FROM meta_ad_report_versions WHERE workspace_id=w),'Revocation did not invalidate revision');
END $$;
SELECT 'PASS: assignment/revocation invalidate report revisions';
