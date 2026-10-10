-- ============================================================================
-- 197: Per-user dashboard theme preference
-- ============================================================================
-- NULL follows the application default theme (dark). A user who picks Light or
-- Dark from the header theme menu stores that choice here so it follows the
-- account across browsers and devices.
--
-- Writes go through PATCH /api/auth/profile, which verifies the JWT and updates
-- only that user's row with the service role, so no authenticated column grant
-- is added.
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme_preference text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_theme_preference_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_theme_preference_check
  CHECK (theme_preference IS NULL OR theme_preference IN ('light', 'dark'));

COMMENT ON COLUMN public.profiles.theme_preference IS
  'Dashboard theme chosen by the user (light or dark). NULL follows the app default.';

COMMIT;
