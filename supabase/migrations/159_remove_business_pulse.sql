-- Business Pulse has been retired. Remove its obsolete permission from
-- existing environments; new environments no longer seed it in migration 093.

DELETE FROM public.role_permissions
WHERE permission_key = 'tab:pulse';
