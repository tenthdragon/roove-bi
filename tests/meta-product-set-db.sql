-- Isolated local clone only. No fixture survives this transaction.
BEGIN;
DO $$
DECLARE w uuid; account text; snapshot jsonb; n integer; observed timestamptz := '2026-01-01T00:00:00Z';
BEGIN
 SELECT workspace_id,account_id INTO w,account FROM meta_ad_accounts LIMIT 1;
 IF w IS NULL THEN RAISE EXCEPTION 'Local test needs an account'; END IF;
 IF EXISTS(SELECT 1 FROM meta_ad_destination_metadata WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999982') THEN RAISE EXCEPTION 'Fixture identity collision'; END IF;
 snapshot := '{"version":1,"urls":[],"product_set_ids":["999999999999999982"]}'::jsonb;
 INSERT INTO meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,metadata,classification,evidence,observed_at)
 VALUES(w,account,'999999999999999982','982',snapshot,'unknown','[]',observed);
 INSERT INTO meta_shopee_product_sets(workspace_id,account_id,product_set_id,verification)
 VALUES(w,account,'999999999999999982','{"method":"test","complete":true,"product_count":1}');
 INSERT INTO meta_product_set_verification_attempts(workspace_id,account_id,product_set_id,checked_at,retry_after,error_message)
 VALUES(w,account,'999999999999999982',now(),now()+interval '1 day','Empty set');
 n := apply_meta_product_set_classifications(w,account,'999999999999999982',jsonb_build_array(jsonb_build_object('ad_id','999999999999999982','classification','cpas','metadata',snapshot,'evidence','[{"type":"verified_product_set_id","value":"999999999999999982"}]'::jsonb)));
 IF n<>1 OR NOT EXISTS(SELECT 1 FROM meta_ad_destination_metadata WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999982' AND classification='cpas' AND observed_at=observed AND metadata=snapshot) THEN RAISE EXCEPTION 'Classification write changed observation or failed'; END IF;
 -- Simulate a fresh destination observed while the verifier was reading products.
 UPDATE meta_ad_destination_metadata SET metadata=jsonb_set(snapshot,'{urls}','["https://roove.co.id/new"]'),classification='unknown' WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999982';
 n := apply_meta_product_set_classifications(w,account,'999999999999999982',jsonb_build_array(jsonb_build_object('ad_id','999999999999999982','classification','cpas','metadata',snapshot,'evidence','[]'::jsonb)));
 IF n<>0 OR NOT EXISTS(SELECT 1 FROM meta_ad_destination_metadata WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999982' AND classification='unknown') THEN RAISE EXCEPTION 'Stale verifier overwrote fresh metadata'; END IF;
 BEGIN
  PERFORM apply_meta_product_set_classifications(w,'act_999999999999999999','999999999999999982','[]');
  RAISE EXCEPTION 'Cross-account proof accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid product set classification scope' THEN RAISE; END IF; END;
 IF has_table_privilege('authenticated','meta_product_set_verification_attempts','SELECT') OR has_table_privilege('anon','meta_product_set_verification_attempts','INSERT') THEN RAISE EXCEPTION 'Cooldown state leaked to browser'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='meta_product_set_verification_attempts'::regclass) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
 IF has_function_privilege('authenticated','apply_meta_product_set_classifications(uuid,text,text,jsonb)','EXECUTE') OR has_function_privilege('anon','apply_meta_product_set_classifications(uuid,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Classification writer leaked to browser'; END IF;
 RAISE NOTICE 'PASS: automatic catalog proof, cooldown storage, classification-only writes, stale-metadata protection, scoped registry, RLS/grants';
END $$;
ROLLBACK;
