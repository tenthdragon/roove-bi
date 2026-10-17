BEGIN;
-- Business rule: a verified Shopee catalog proves CPAS regardless of the
-- creative's website URL. Repair observations held back by the previous rule.
-- Only an exact workspace/account registry match is accepted; never catalog names.
WITH eligible AS (
 SELECT d.workspace_id,d.account_id,d.ad_id,d.creative_id,d.adset_id,d.metadata,
  coalesce((SELECT jsonb_agg(item ORDER BY ordinal)
   FROM jsonb_array_elements(d.evidence) WITH ORDINALITY old(item,ordinal)
   WHERE item->>'type' IS DISTINCT FROM 'conflicting_website_url'
    AND item->>'type' IS DISTINCT FROM 'verified_product_set_id'),'[]'::jsonb)
  || (SELECT jsonb_agg(jsonb_build_object('type','verified_product_set_id','value',s.product_set_id) ORDER BY s.product_set_id)
   FROM public.meta_shopee_product_sets s
   WHERE s.workspace_id=d.workspace_id AND s.account_id=d.account_id
    AND d.metadata->'product_set_ids' ? s.product_set_id) AS evidence
 FROM public.meta_ad_destination_metadata d
 WHERE d.classification='unknown' AND jsonb_typeof(d.metadata->'product_set_ids')='array'
  AND EXISTS(SELECT 1 FROM public.meta_shopee_product_sets s
   WHERE s.workspace_id=d.workspace_id AND s.account_id=d.account_id
    AND d.metadata->'product_set_ids' ? s.product_set_id)
)
UPDATE public.meta_ad_destination_metadata d SET classification='cpas',evidence=e.evidence
FROM eligible e
WHERE d.workspace_id=e.workspace_id AND d.account_id=e.account_id AND d.ad_id=e.ad_id
 AND d.classification='unknown' AND d.metadata=e.metadata
 AND d.creative_id IS NOT DISTINCT FROM e.creative_id AND d.adset_id IS NOT DISTINCT FROM e.adset_id;
-- The report revision trigger from 206 invalidates cached channel membership.
COMMIT;
