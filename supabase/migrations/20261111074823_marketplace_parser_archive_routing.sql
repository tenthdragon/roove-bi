-- Append-only parser sources, export runs and exact-case routing approvals.
-- No order/sales tables or existing parser configuration are modified.
BEGIN;
CREATE TABLE public.marketplace_parser_batches (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
 account_id text NOT NULL,
 business_code text NOT NULL,
 account_snapshot jsonb NOT NULL CHECK (jsonb_typeof(account_snapshot)='object'),
 filename text NOT NULL,
 source_path text NOT NULL UNIQUE,
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
 byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
 batch_date date NOT NULL,
 parsed_file jsonb NOT NULL CHECK (jsonb_typeof(parsed_file)='object'),
 order_count integer NOT NULL CHECK (order_count BETWEEN 1 AND 20000),
 created_by uuid NOT NULL,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (workspace_id,id)
);
CREATE INDEX marketplace_parser_batches_recent ON public.marketplace_parser_batches(workspace_id,created_at DESC,id);
CREATE TABLE public.marketplace_parser_exports (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 business_code text NOT NULL,
 config_revision integer NOT NULL,
 catalog_version text NOT NULL,
 csv_path text NOT NULL UNIQUE,
 snapshot_path text NOT NULL UNIQUE,
 csv_sha256 text NOT NULL,
 snapshot_sha256 text NOT NULL,
 created_by uuid NOT NULL,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,batch_id) REFERENCES public.marketplace_parser_batches(workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX marketplace_parser_exports_batch ON public.marketplace_parser_exports(workspace_id,batch_id,created_at DESC);
CREATE TABLE public.marketplace_parser_route_decisions (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
 account_id text NOT NULL,
 business_code text NOT NULL,
 case_key text NOT NULL CHECK (length(case_key) BETWEEN 1 AND 20000),
 case_hash text NOT NULL CHECK (case_hash ~ '^[a-f0-9]{64}$'),
 items jsonb NOT NULL CHECK (jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 200),
 store_id integer NOT NULL REFERENCES public.scalev_store_channels(id) ON DELETE RESTRICT,
 store_name text NOT NULL,
 revision integer NOT NULL CHECK (revision>0),
 source_batch_id uuid NOT NULL,
 source_order_key text NOT NULL,
 created_by uuid NOT NULL,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,source_batch_id) REFERENCES public.marketplace_parser_batches(workspace_id,id) ON DELETE RESTRICT,
 UNIQUE(workspace_id,account_id,business_code,case_hash,revision)
);
CREATE INDEX marketplace_parser_decisions_read ON public.marketplace_parser_route_decisions(workspace_id,created_at,id);
ALTER TABLE public.marketplace_parser_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_parser_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_parser_route_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_parser_batches,public.marketplace_parser_exports,public.marketplace_parser_route_decisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.marketplace_parser_batches,public.marketplace_parser_exports,public.marketplace_parser_route_decisions TO service_role;
-- Storage objects are private and only reached through authenticated, workspace-
-- scoped server handlers. No public/authenticated bucket policy is introduced.
INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES('marketplace-parser-archive','marketplace-parser-archive',false,52428800);
CREATE POLICY parser_archive_server_only ON storage.objects AS RESTRICTIVE
FOR ALL TO anon,authenticated USING (bucket_id <> 'marketplace-parser-archive')
WITH CHECK (bucket_id <> 'marketplace-parser-archive');
COMMIT;
