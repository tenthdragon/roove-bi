// Stable, name-based metadata. No OIDs, passwords, customer rows or credentials.
export const catalogQuery=`SELECT jsonb_build_object(
 'version',current_setting('server_version'),
 'database_bytes',pg_database_size(current_database()),
 'locale',(SELECT jsonb_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype) FROM pg_database WHERE datname=current_database()),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname) ORDER BY rolname) FROM pg_roles WHERE rolname NOT LIKE 'pg_%'),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'schema',n.nspname) ORDER BY extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'),
 'schema_fingerprints',(SELECT jsonb_object_agg(nspname,fingerprint) FROM (
   SELECT n.nspname,md5(coalesce((SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
     'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
     'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
     'indexes',(SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid),
     'view',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,false) END,
     'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid,false) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal),
     'policies',(SELECT jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'public' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(polroles) r),'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid=c.oid)
     ) ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m','S')),'[]'::jsonb)::text ||
     coalesce((SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p WHERE p.pronamespace=n.oid AND p.prokind IN ('f','p') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')),'[]'::jsonb)::text ||
     coalesce((SELECT jsonb_agg(jsonb_build_object('name',t.typname,'labels',(SELECT jsonb_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid=t.oid)) ORDER BY t.typname) FROM pg_type t WHERE t.typnamespace=n.oid AND t.typtype='e'),'[]'::jsonb)::text) AS fingerprint
   FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
 ) fingerprints)
);`;
export const countQueries=`SELECT format('SELECT jsonb_build_object(''table'',%L,''count'',count(*)) FROM %I.%I;',n.nspname||'.'||c.relname,n.nspname,c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
 ORDER BY n.nspname,c.relname;\n\\gexec\n`;
