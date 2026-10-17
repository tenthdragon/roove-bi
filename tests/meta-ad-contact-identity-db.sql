BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'local database required'; END IF; END $$;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE contact_scope AS SELECT workspace_id,account_id FROM meta_ad_accounts WHERE is_active LIMIT 1;
INSERT INTO meta_ad_mappings(workspace_id,account_id,ad_id,ad_name,creative_id,landing_page_urls,auto_mapping,source,fingerprint)
 SELECT workspace_id,account_id,'999999974001','Contact identity test','999999974002','[]','{"tags":[],"keywords":[],"issues":[],"free_text":"test"}','inventory','contact-test' FROM contact_scope;
INSERT INTO meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,adset_id,metadata,classification,evidence,observed_at)
 SELECT workspace_id,account_id,'999999974001','999999974002','999999974003','{"urls":["https://api.whatsapp.com/send"],"product_set_ids":[]}', 'unknown','[]',now() FROM contact_scope;
DO $$ DECLARE d meta_ad_destination_metadata; ident jsonb; r jsonb; before_time timestamptz; BEGIN
 SELECT * INTO STRICT d FROM meta_ad_destination_metadata WHERE ad_id='999999974001';
 before_time:=d.observed_at;
 ident:='{"version":1,"creative_id":"999999974002","adset_id":"999999974003","page_id":"123","page_ids":["123"],"page_sources":{"promoted":"123"},"whatsapp_phone_numbers":["+6281234567890"],"whatsapp_sources":[{"path":"promoted.whatsapp_phone_number","number":"+6281234567890"}]}';
 r:=save_meta_ad_contact_identities(d.workspace_id,jsonb_build_array(jsonb_build_object('account_id',d.account_id,'ad_id',d.ad_id,'creative_id',d.creative_id,'adset_id',d.adset_id,'identity',ident,'observed_at',now())));
 IF r->>'saved'<>'1' THEN RAISE EXCEPTION 'Identity was not saved: %',r; END IF;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF d.metadata->'contact_identity' IS DISTINCT FROM ident OR d.observed_at<>before_time OR d.metadata->'urls'<>'["https://api.whatsapp.com/send"]'::jsonb OR d.classification<>'unknown' THEN RAISE EXCEPTION 'Backfill changed non-contact fields'; END IF;
 -- An older sync worker omits the new fields. Preserve same-creative identity.
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":["https://api.whatsapp.com/send"],"product_set_ids":["456"]}',observed_at=now() WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF d.metadata->'contact_identity' IS DISTINCT FROM ident OR d.metadata->'product_set_ids'<>'["456"]'::jsonb THEN RAISE EXCEPTION 'Legacy sync lost contact identity or new catalog'; END IF;
 -- A newer observation replaces a number; numbers do not accumulate forever.
 ident:=ident||'{"whatsapp_phone_numbers":["+6289999999999"],"whatsapp_sources":[]}';
 UPDATE meta_ad_destination_metadata SET metadata=metadata||jsonb_build_object('contact_identity',ident) WHERE ad_id=d.ad_id;
 IF (SELECT metadata->'contact_identity'->'whatsapp_phone_numbers' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id)<>'["+6289999999999"]'::jsonb THEN RAISE EXCEPTION 'Number not replaced'; END IF;
 -- Same-Page opaque phone response keeps the last known number.
 ident:=ident||'{"whatsapp_phone_numbers":[],"whatsapp_sources":[]}';
 UPDATE meta_ad_destination_metadata SET metadata=metadata||jsonb_build_object('contact_identity',ident) WHERE ad_id=d.ad_id;
 IF jsonb_array_length((SELECT metadata->'contact_identity'->'whatsapp_phone_numbers' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id))<>1 THEN RAISE EXCEPTION 'Opaque phone response erased known number'; END IF;
 -- A changed Page cannot inherit the old Page's number.
 ident:=ident||'{"page_id":"789","page_ids":["789"],"page_sources":{"promoted":"789"}}';
 UPDATE meta_ad_destination_metadata SET metadata=metadata||jsonb_build_object('contact_identity',ident) WHERE ad_id=d.ad_id;
 IF jsonb_array_length((SELECT metadata->'contact_identity'->'whatsapp_phone_numbers' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id))<>0 THEN RAISE EXCEPTION 'New Page inherited old phone'; END IF;
 r:=save_meta_ad_contact_identities(d.workspace_id,jsonb_build_array(jsonb_build_object('account_id',d.account_id,'ad_id',d.ad_id,'creative_id',d.creative_id,'adset_id',d.adset_id,'identity',ident,'observed_at',now()-interval '1 day')));
 IF r->>'saved'<>'0' THEN RAISE EXCEPTION 'Stale observation overwrote current identity'; END IF;
 -- Scope is enforced by workspace, account, ad, creative and adset.
 ident:=ident||'{"creative_id":"999999974099"}';
 r:=save_meta_ad_contact_identities(d.workspace_id,jsonb_build_array(jsonb_build_object('account_id',d.account_id,'ad_id',d.ad_id,'creative_id','999999974099','adset_id',d.adset_id,'identity',ident,'observed_at',now())));
 IF r->>'saved'<>'0' THEN RAISE EXCEPTION 'Stale creative was patched'; END IF;
 UPDATE meta_ad_destination_metadata SET creative_id='999999974099' WHERE ad_id=d.ad_id;
 IF (SELECT metadata ? 'contact_identity' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id) THEN RAISE EXCEPTION 'Changed creative inherited identity'; END IF;
 ident:=ident||jsonb_build_object('adset_id','999999974003');
 UPDATE meta_ad_destination_metadata SET metadata=metadata||jsonb_build_object('contact_identity',ident) WHERE ad_id=d.ad_id;
 UPDATE meta_ad_destination_metadata SET adset_id='999999974098' WHERE ad_id=d.ad_id;
 IF (SELECT metadata ? 'contact_identity' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id) THEN RAISE EXCEPTION 'Changed adset inherited identity'; END IF;
 IF meta_ad_contact_identity_valid('{"page_ids":"bad"}',d.creative_id,d.adset_id) THEN RAISE EXCEPTION 'Malformed identity accepted'; END IF;
 IF has_function_privilege('anon','public.save_meta_ad_contact_identities(uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.save_meta_ad_contact_identities(uuid,jsonb)','EXECUTE') OR has_table_privilege('authenticated','meta_ad_destination_metadata','SELECT') THEN RAISE EXCEPTION 'Contact data exposed to browser roles'; END IF;
END $$;
SELECT 'PASS: contact persistence, legacy sync, empty response, current number, changed Page, creative/adset scope, stale backfill and RLS';
ROLLBACK;
