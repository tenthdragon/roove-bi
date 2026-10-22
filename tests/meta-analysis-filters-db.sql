-- A savepoint isolates these fixtures from the other suites; everything rolls back.
CREATE TEMP TABLE analysis_expected AS
 SELECT f.*,s.workspace_id,s.account_id,
  CASE WHEN f.n=13 THEN 'unknown' WHEN f.n IN(1,2,9,10) THEN 'video' ELSE 'image' END AS format,
  CASE WHEN f.n IN(1,9,10) THEN 'partnership' WHEN f.n=2 THEN 'non_partnership' ELSE 'unknown' END AS partnership,
  jsonb_build_array(CASE WHEN f.n=4 THEN 'OUTCOME_TRAFFIC' ELSE 'OUTCOME_SALES' END,
   CASE WHEN f.n=12 THEN NULL WHEN f.n=4 THEN 'LINK_CLICKS' ELSE 'OFFSITE_CONVERSIONS' END,
   CASE WHEN f.n IN(4,12) THEN NULL WHEN f.n IN(1,2,9) THEN 'PURCHASE' WHEN f.n=10 THEN 'ADD_TO_CART' ELSE 'INITIATED_CHECKOUT' END,NULL) AS optimization
 FROM ctwa_fixture f JOIN ctwa_scope s ON s.n=f.account_n;
UPDATE meta_ad_creatives c SET creative_format=CASE WHEN f.n IN(1,2,9,10) THEN 'video' ELSE 'image' END,
 partnership_metadata=CASE WHEN f.n IN(1,9,10,13) THEN '{"version":1,"status":"partnership"}'::jsonb WHEN f.n=2 THEN '{"version":1,"status":"non_partnership"}'::jsonb ELSE NULL END
 FROM analysis_expected f WHERE c.workspace_id=f.workspace_id AND c.account_id=f.account_id AND c.ad_id=f.ad_id;
UPDATE meta_ad_daily_metrics d SET currency='IDR',metrics=jsonb_build_object('spend',f.n*CASE WHEN d.metric_date='1996-01-02' THEN 1000 ELSE 500 END,
 'impressions',f.n*100,'outbound_clicks',f.n*10,'lpv',f.n*5,'atc',f.n*2,'checkout',f.n,'purchases',CASE WHEN f.n=2 THEN 0 WHEN f.n=9 THEN 2 ELSE 1 END),
 raw_insights=d.raw_insights||jsonb_build_object('campaign_id','999800'||f.account_n::text,'objective',CASE WHEN f.n=4 THEN 'OUTCOME_TRAFFIC' ELSE 'OUTCOME_SALES' END)
 FROM analysis_expected f WHERE d.workspace_id=f.workspace_id AND d.account_id=f.account_id AND d.ad_id=f.ad_id;
DO $$ DECLARE row record; BEGIN
 FOR row IN SELECT workspace_id,account_id,jsonb_agg(jsonb_build_object('adset_id',adset_id,'campaign_id','999800'||account_n::text,
  'campaign_objective',optimization->>0,'optimization_goal',CASE WHEN n=12 THEN 'OFFSITE_CONVERSIONS' ELSE optimization->>1 END,
  'conversion_event',CASE WHEN n=12 THEN 'PURCHASE' ELSE optimization->>2 END,'source_updated_at','1996-01-03T00:00:00Z')) AS ads FROM analysis_expected GROUP BY workspace_id,account_id LOOP
  PERFORM save_meta_adset_optimizations(row.workspace_id,row.account_id,row.ads,'1996-01-04');
 END LOOP;
END $$;
-- Prior creative/adset identities differ: comparisons must follow the current selected cohort.
UPDATE meta_ad_daily_metrics SET creative_id='777',raw_insights=raw_insights||'{"adset_id":"888","campaign_id":"777","objective":"OUTCOME_TRAFFIC"}'
 WHERE ad_id='99999997301' AND metric_date='1996-01-01';
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; config jsonb; filters jsonb; fmt text; partner text; opt text;
 r jsonb; e record; item jsonb; expected_count integer; other jsonb; b text; a text; cases integer:=0;
 purchase text:='["OUTCOME_SALES","OFFSITE_CONVERSIONS","PURCHASE",null]';
 BEGIN
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id),'name_filter','CTWA fixture','match','contains','include_matrix',true,'include_optimization',true,'include_analysis',true) INTO config FROM ctwa_scope;
 FOREACH fmt IN ARRAY ARRAY['','image','video','unknown'] LOOP
 FOREACH partner IN ARRAY ARRAY['','partnership','non_partnership','unknown'] LOOP
 FOREACH opt IN ARRAY ARRAY['',purchase,'["OUTCOME_SALES","OFFSITE_CONVERSIONS","ADD_TO_CART",null]'] LOOP
  filters:=jsonb_strip_nulls(jsonb_build_object('format',nullif(fmt,''),'partnership',nullif(partner,''),'optimization',nullif(opt,'')));
  SELECT count(*) n,coalesce(sum(n*1000),0) spend,coalesce(sum(n*500),0) prior,
   coalesce(sum(CASE WHEN n=2 THEN 0 WHEN n=9 THEN 2 ELSE 1 END),0) purchases INTO e
   FROM analysis_expected WHERE (fmt='' OR format=fmt) AND (partner='' OR partnership=partner) AND (opt='' OR optimization=nullif(opt,'')::jsonb);
  r:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters,NULL,'ad');
  IF (r->>'matchingAds')::integer<>e.n OR (r#>>'{summary,spend}')::numeric<>e.spend OR (r#>>'{previous,spend}')::numeric<>e.prior
   OR (r#>>'{summary,purchases}')::numeric<>e.purchases THEN RAISE EXCEPTION 'Intersection/cohort totals failed: % => % expected %',filters,jsonb_build_object('summary',r->'summary','previous',r->'previous','ads',r->'matchingAds'),to_jsonb(e); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'groups') g WHERE jsonb_array_length(g->'optimization_breakdown')<>1 OR g->'matrix_metadata' IS NULL) THEN RAISE EXCEPTION 'Filtered matrix metadata missing';END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(r->'analysisFacets') LOOP
   SELECT count(*) INTO expected_count FROM analysis_expected WHERE
    (item->>'dimension'='format' OR fmt='' OR format=fmt) AND (item->>'dimension'='partnership' OR partner='' OR partnership=partner)
    AND (item->>'dimension'='optimization' OR opt='' OR optimization=nullif(opt,'')::jsonb)
    AND CASE item->>'dimension' WHEN 'format' THEN format=item->>'value' WHEN 'partnership' THEN partnership=item->>'value' ELSE optimization=(item->>'value')::jsonb END;
   IF (item->>'count')::integer<>expected_count THEN RAISE EXCEPTION 'Facet counts must ignore only their own filter: %, %, expected %',filters,item,expected_count;END IF;
  END LOOP;
  other:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters,NULL,'cep_intention');
  IF other->'summary' IS DISTINCT FROM r->'summary' OR other->'previous' IS DISTINCT FROM r->'previous' THEN RAISE EXCEPTION 'CEP cohort differs';END IF;
  other:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters,NULL,'landing_page');
  IF other->'summary' IS DISTINCT FROM r->'summary' OR other->'previous' IS DISTINCT FROM r->'previous' THEN RAISE EXCEPTION 'Destination cohort differs';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(other->'groups') g WHERE
   (SELECT sum((c#>>'{current,spend}')::numeric) FROM jsonb_array_elements(g->'partnership_breakdown') c) IS DISTINCT FROM (g#>>'{current,spend}')::numeric) THEN RAISE EXCEPTION 'Breakdown no longer reconciles'; END IF;
  cases:=cases+1;
 END LOOP;END LOOP;END LOOP;
 filters:=jsonb_build_object('format','video','partnership','partnership','optimization',purchase);
 r:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters);
 IF r#>>'{summary,spend}'<>'10000' OR r#>>'{summary,purchases}'<>'3' OR r#>>'{previous,spend}'<>'5000' THEN RAISE EXCEPTION 'Known purchase/video/partnership cohort incorrect';END IF;
 other:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters,NULL,'landing_page','daily');
 IF other#>>'{history,1,totals,spend}'<>'10000' OR other#>>'{history,0,totals,spend}'<>'5000' THEN RAISE EXCEPTION 'Daily history ignores filters or prior cohort';END IF;
 other:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters,NULL,'landing_page','trends');
 IF (SELECT sum((h#>>'{totals,spend}')::numeric) FROM jsonb_array_elements(other->'history') h)<>15000 THEN RAISE EXCEPTION 'Trends ignore filters';END IF;
 SELECT value INTO item FROM jsonb_array_elements(r->'groups') g WHERE g->'ad_ids' ? '99999997301';
 other:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters,NULL,'landing_page','creatives','week',item->>'key');
 IF jsonb_array_length(other->'creatives')<>1 OR other#>>'{creatives,0,ad_id}'<>'99999997301' THEN RAISE EXCEPTION 'Drawer ignores selected cohort';END IF;
 filters:=jsonb_build_object('channel','cpas','format','video','partnership','partnership','optimization','["OUTCOME_SALES","OFFSITE_CONVERSIONS","ADD_TO_CART",null]');
 r:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters,NULL,'ad');
 IF r->>'matchingAds'<>'1' OR r#>>'{summary,spend}'<>'10000' THEN RAISE EXCEPTION 'CPAS intersection incorrect';END IF;
 SELECT account_id INTO a FROM ctwa_scope WHERE n=1;
 SELECT default_brand_id::text INTO b FROM meta_ad_accounts WHERE workspace_id=w AND account_id=a;
 r:=get_meta_brand_detail_report(w,'1996-01-02','1996-01-02',b,'cpas',filters-'channel');
 IF r#>>'{cpas,summary,spend}'<>'10000' OR r#>>'{cep,summary,spend}'<>'10000' OR NOT (r->'cpas' ? 'analysisFacets') THEN RAISE EXCEPTION 'Batched detail filters/facets missing';END IF;
 other:=get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02',config,filters);
 IF other->>'matchingAds'<>'0' THEN RAISE EXCEPTION 'Workspace leaked';END IF;
 -- Selecting unknown never borrows stale creative identity or classifies it non-partnership.
 r:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,'{"format":"unknown","partnership":"unknown"}');
 IF r->>'matchingAds'<>'1' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'groups') g WHERE g->'ad_ids' ? '999999973013') THEN RAISE EXCEPTION 'Mismatched creative is not unknown';END IF;
 FOREACH filters IN ARRAY ARRAY['{"format":"bogus"}','{"partnership":null}','{"optimization":"[]"}','{"optimization":[null,null,null,null]}','{"optimization":"[null,null,null,12]"}']::jsonb[] LOOP
  BEGIN PERFORM get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters);RAISE EXCEPTION 'accepted malformed filter';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted malformed filter' THEN RAISE;END IF;END;
 END LOOP;
 RAISE NOTICE 'PASS: % filter intersections across destination/ad/CEP, matrix cohorts, distinct facets, current/prior totals, daily/trends/drawer, CPAS, unknown identity and workspace isolation',cases;
END $$;
