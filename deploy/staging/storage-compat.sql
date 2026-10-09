-- Non-production overlay only. The self-hosted Storage API uses a single current
-- object per bucket/path; the hosted snapshot has partial versioning indexes.
-- Preserve those indexes and add the conflict target required for ordinary uploads.
-- Do not apply this overlay to hosted production or use object versioning here.
CREATE UNIQUE INDEX IF NOT EXISTS roove_nonproduction_storage_name
ON storage.objects (name, bucket_id);
