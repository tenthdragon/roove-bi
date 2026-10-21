-- Snapshot the prior implementation before replacing the function, in this rollback only.
CREATE TEMP TABLE optimization_ad_parity ON COMMIT DROP AS
SELECT b.group_by,c.channel,f.filters,enabled.flag,
 jsonb_build_object('account_ids',(SELECT jsonb_agg(account_id) FROM ctwa_scope),'include_optimization',enabled.flag) config,
 public.get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000001','1996-01-02','1996-01-02',
 jsonb_build_object('account_ids',(SELECT jsonb_agg(account_id) FROM ctwa_scope),'include_optimization',enabled.flag),
 f.filters||CASE WHEN c.channel IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('channel',c.channel) END,NULL,b.group_by) expected
FROM unnest(ARRAY['ad','landing_page','cep_intention']) b(group_by)
CROSS JOIN unnest(ARRAY[NULL,'non_cpas','cpas']::text[]) c(channel)
CROSS JOIN (VALUES('{}'::jsonb),('{"intention":"cons"}'::jsonb)) f(filters)
CROSS JOIN (VALUES(false),(true)) enabled(flag);
