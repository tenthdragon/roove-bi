CREATE FUNCTION pg_temp.assert_true(v boolean,m text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION '%',m; END IF; END $$;
-- Compare every field consumed by websiteWorld/cpasWorld and global filters to
-- the existing report, including mixed currencies, CTWA and overlapping CEPs.
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; f jsonb; r jsonb; old jsonb; item jsonb; k text; expected jsonb; actual jsonb; t timestamptz; BEGIN
 FOREACH f IN ARRAY ARRAY['{}','{"cep":"joint"}','{"cep":"__unknown__"}','{"intention":"cons"}','{"objective":"__unknown__"}','{"cep":"joint","intention":"cons","objective":"__unknown__"}','{"objective":"OUTCOME_SALES"}']::jsonb[] LOOP
  r:=get_meta_brand_overview_report(w,'1996-01-02','1996-01-02',f);
  FOR item IN SELECT value FROM jsonb_array_elements(r->'reports') LOOP
   old:=get_meta_ad_report(w,'1996-01-02','1996-01-02','{}',f||jsonb_build_object('channel',item->>'channel'),item->>'brand',CASE WHEN item->>'channel'='cpas' THEN 'ad' ELSE 'landing_page' END);
   FOREACH k IN ARRAY ARRAY['summary','previous','currencies','groups','matchingAds'] LOOP
    PERFORM pg_temp.assert_true(item->'report'->k=old->k,'Report mismatch for '||(item->>'brand')||'/'||(item->>'channel')||'/'||k||' filters='||f::text);
   END LOOP;
   FOREACH k IN ARRAY ARRAY['urls','missing_ads','multi_ads'] LOOP
    PERFORM pg_temp.assert_true(item#>ARRAY['report','destinations',k]=old#>ARRAY['destinations',k],'Destination mismatch '||k);
   END LOOP;
   PERFORM pg_temp.assert_true(NOT EXISTS((SELECT value FROM jsonb_array_elements(item#>'{report,coverage}') EXCEPT SELECT value FROM jsonb_array_elements(old->'coverage')) UNION ALL
    (SELECT value FROM jsonb_array_elements(old->'coverage') EXCEPT SELECT value FROM jsonb_array_elements(item#>'{report,coverage}'))),'Coverage mismatch');
  END LOOP;
  old:=get_meta_ad_report(w,'1996-01-02','1996-01-02','{}',f||'{"channel":"non_cpas"}');
  PERFORM pg_temp.assert_true(r->'facetTotals'=old->'facetTotals' AND r->'cepLabels'=old->'cepLabels','Global facet totals/labels mismatch');
  PERFORM pg_temp.assert_true(NOT EXISTS((SELECT value FROM jsonb_array_elements(r->'facets') EXCEPT SELECT value FROM jsonb_array_elements(old->'facets')) UNION ALL
   (SELECT value FROM jsonb_array_elements(old->'facets') EXCEPT SELECT value FROM jsonb_array_elements(r->'facets'))),'Global facet counts mismatch');
  WITH source AS (
   SELECT x.value->>'brand' AS brand,g.value FROM jsonb_array_elements(r->'reports') x
   CROSS JOIN LATERAL jsonb_array_elements(get_meta_ad_report(w,'1996-01-02','1996-01-02','{}',f||jsonb_build_object('channel',x.value->>'channel'),x.value->>'brand','cep_intention')->'groups') g
  ), sums AS (SELECT brand,replace(replace(split_part(value->>'key',':',2),'%3A',':'),'%25','%') AS cep,sum((value#>>'{current,spend}')::numeric) AS spend FROM source GROUP BY 1,2)
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY brand,cep),'[]') INTO expected FROM sums s;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'brand',value->>'cep'),'[]') INTO actual FROM jsonb_array_elements(r->'cepSpend');
  PERFORM pg_temp.assert_true(actual=expected,'CEP spend mismatch: '||f::text);
 END LOOP;
 -- A warm read and changing filters must reuse all projected dates.
 SELECT max(refreshed_at) INTO t FROM meta_brand_report_days WHERE workspace_id=w;
 PERFORM get_meta_brand_overview_report(w,'1996-01-02','1996-01-02','{}');
 PERFORM pg_temp.assert_true((SELECT max(refreshed_at)=t FROM meta_brand_report_days WHERE workspace_id=w),'Warm request recomputed source data');
 r:=get_meta_brand_overview_report(w,'1996-02-02','1996-02-02');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'reports') x WHERE (x#>>'{report,summary,spend}')::numeric<>0),'Empty range contains spend');
END $$;
SELECT 'PASS: batch equals existing reports for totals, groups, currencies, distinct ads, CTWA, coverage, facets, active ads and multi-CEP filters';

CREATE TEMP TABLE cache_before AS SELECT * FROM meta_brand_report_days;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; a text; r jsonb; n integer; t timestamptz; BEGIN
 SELECT s.account_id INTO a FROM ctwa_scope s WHERE s.n=1;
 UPDATE meta_ad_daily_metrics SET metrics=jsonb_set(metrics,'{spend}','123') WHERE workspace_id=w AND account_id=a AND ad_id='99999997301' AND metric_date='1996-01-02';
 r:=get_meta_brand_overview_report(w,'1996-01-02','1996-01-02');
 SELECT count(*) INTO n FROM meta_brand_report_days d JOIN cache_before b USING(workspace_id,account_id,metric_date) WHERE d.refreshed_at<>b.refreshed_at;
 PERFORM pg_temp.assert_true(n=1,'One metric day refreshed unrelated dates/accounts: '||n);
 -- Deleting every fact in a cached day must replace its old payload with [].
 DELETE FROM meta_ad_daily_metrics WHERE workspace_id=w AND account_id=a AND metric_date='1996-01-01';
 PERFORM get_meta_brand_overview_report(w,'1996-01-02','1996-01-02');
 PERFORM pg_temp.assert_true((SELECT rows='[]' FROM meta_brand_report_days WHERE workspace_id=w AND account_id=a AND metric_date='1996-01-01'),'Deleted daily facts remained cached');
 -- Failed source writes cannot advance invalidation versions.
 SELECT max(refreshed_at) INTO t FROM meta_brand_report_days WHERE workspace_id=w;
 BEGIN
  UPDATE meta_ad_daily_metrics SET metrics='{"spend":900}' WHERE workspace_id=w AND account_id=a AND metric_date='1996-01-02';
  RAISE EXCEPTION 'fixture rollback';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'fixture rollback' THEN RAISE; END IF; END;
 PERFORM get_meta_brand_overview_report(w,'1996-01-02','1996-01-02');
 PERFORM pg_temp.assert_true((SELECT max(refreshed_at)=t FROM meta_brand_report_days WHERE workspace_id=w),'Rolled-back write invalidated cache');
 -- Metadata can change historical channel/URL/objective decisions for one account.
 UPDATE meta_ad_destination_metadata SET metadata=metadata||'{"urls":["https://example.com/changed"]}' WHERE workspace_id=w AND account_id=a AND ad_id='99999997309';
 PERFORM get_meta_brand_overview_report(w,'1996-01-02','1996-01-02');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM meta_brand_report_days d JOIN cache_before b USING(workspace_id,account_id,metric_date) WHERE d.account_id<>a AND d.refreshed_at<>b.refreshed_at),'Metadata refreshed another account');
END $$;
SELECT 'PASS: metric-day invalidation, deletion, account-only metadata refresh and rollback isolation';
-- Live taxonomy and coverage changes do not rebuild metric/URL projections.
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; a text; b integer; r jsonb; t timestamptz; saved jsonb; BEGIN
 SELECT s.account_id INTO a FROM ctwa_scope s WHERE s.n=1;
 SELECT default_brand_id INTO b FROM meta_ad_accounts WHERE workspace_id=w AND account_id=a;
 SELECT max(refreshed_at) INTO t FROM meta_brand_report_days WHERE workspace_id=w;
 UPDATE meta_ad_mappings SET last_seen_at=clock_timestamp() WHERE workspace_id=w;
 UPDATE meta_ad_creatives SET name=name||' changed copy' WHERE workspace_id=w AND ad_id LIKE '999999973%';
 UPDATE meta_ad_daily_metrics SET metrics=metrics WHERE workspace_id=w AND metric_date='1996-01-02';
 PERFORM get_meta_brand_overview_report(w,'1996-01-02','1996-01-02');
 PERFORM pg_temp.assert_true((SELECT max(refreshed_at)=t FROM meta_brand_report_days WHERE workspace_id=w),'Non-reporting inventory/creative/no-op writes rebuilt projections');
 UPDATE meta_ad_mappings SET overrides='{"ceps":["bone"],"intention":"conv"}' WHERE workspace_id=w AND account_id=a AND ad_id='99999997301';
 r:=get_meta_brand_overview_report(w,'1996-01-02','1996-01-02','{"cep":"bone"}');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(r->'cepSpend') c WHERE c->>'cep'='bone' AND (c->>'spend')::numeric>0),'Live taxonomy override remained stale');
 PERFORM pg_temp.assert_true((SELECT max(refreshed_at)=t FROM meta_brand_report_days WHERE workspace_id=w),'Taxonomy-only override rebuilt projections');
 UPDATE meta_ad_cep_catalog SET label='Fixture renamed CEP' WHERE workspace_id=w AND brand_id=b AND key='joint';
 DELETE FROM meta_ad_sync_coverage WHERE workspace_id=w AND account_id=a AND metric_date='1996-01-02';
 r:=get_meta_brand_overview_report(w,'1996-01-02','1996-01-02','{"cep":"joint"}');
 PERFORM pg_temp.assert_true(r#>>'{cepLabels,joint}'='Fixture renamed CEP','Taxonomy labels remained stale');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'reports') x CROSS JOIN LATERAL jsonb_array_elements(x#>'{report,coverage}') c WHERE c->>'account_id'=a AND c->>'metric_date'='1996-01-02'),'Coverage remained stale');
 PERFORM pg_temp.assert_true((SELECT max(refreshed_at)=t FROM meta_brand_report_days WHERE workspace_id=w),'Taxonomy/coverage rebuilt projections');
 -- A delayed older reader cannot overwrite a newer certified day cache.
 SELECT to_jsonb(d) INTO saved FROM meta_brand_report_days d WHERE workspace_id=w AND account_id=a AND metric_date='1996-01-02';
 PERFORM refresh_meta_brand_report_days(w,jsonb_build_array(jsonb_build_object('account_id',a,'metric_date','1996-01-02','day_revision',-1,'account_revision',-1,'workspace_revision',-1)));
 PERFORM pg_temp.assert_true((SELECT to_jsonb(d)=saved FROM meta_brand_report_days d WHERE workspace_id=w AND account_id=a AND metric_date='1996-01-02'),'Older refresh overwrote a newer cache certificate');
 -- Reassigning an account changes its historical CTWA brand scope.
 UPDATE meta_ad_accounts SET default_brand_id=NULL,store='' WHERE workspace_id=w AND account_id=a;
 r:=get_meta_brand_overview_report(w,'1996-01-02','1996-01-02');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM jsonb_array_elements(r->'reports') x WHERE x->>'brand'='__unmapped__' AND (x#>>'{report,matchingAds}')::int>0),'Account brand reassignment remained stale');
END $$;
SELECT 'PASS: live taxonomy/coverage, delayed refresh protection and historical account reassignment';
DO $$ BEGIN
 PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','public.get_meta_brand_overview_report(uuid,date,date,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.refresh_meta_brand_report_days(uuid,jsonb)','EXECUTE'),'Browser can execute report/cache helpers');
 PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','meta_brand_report_days','SELECT') AND NOT has_table_privilege('authenticated','meta_brand_report_epochs','UPDATE'),'Browser can access projection/epochs');
 PERFORM pg_temp.assert_true((SELECT relrowsecurity FROM pg_class WHERE oid='public.meta_brand_report_days'::regclass),'Cache RLS disabled');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM meta_brand_report_days WHERE workspace_id<>'00000000-0000-4000-8000-000000000001'),'Projection crossed workspace boundary');
END $$;
SELECT 'PASS: workspace isolation and service-only permissions';
